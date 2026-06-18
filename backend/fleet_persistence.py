"""
Build and persist fleet inspection records from API responses.
Does not touch YOLO inference — only post-processes results.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from database import save_inspection
from inspection_report import (
    enrich_detection,
    generate_combined_report,
    normalize_view_label,
)

logger = logging.getLogger(__name__)


def _overall_severity_from_damages(damages: list[dict[str, Any]]) -> str:
    if not damages:
        return "None"

    confirmed = [d for d in damages if not d.get("verification_required")]
    if not confirmed:
        return "Low"

    severities = [d.get("severity", "Low") for d in confirmed]
    if "High" in severities or len(confirmed) >= 6:
        return "High"
    if "Medium" in severities or len(confirmed) >= 3:
        return "Medium"
    return "Low"


def _damages_from_detections(
    detections: list[dict],
    *,
    view: str = "unknown",
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for det in detections or []:
        enriched = enrich_detection(det, view=view)
        items.append({
            "view": enriched.get("view", view),
            "damage_type": enriched.get("damage_type", "unknown"),
            "confidence": enriched.get("confidence", 0),
            "severity": enriched.get("severity", "Low"),
            "verification_required": enriched.get("verification_required", False),
            "confidence_tier": enriched.get("confidence_tier", "confirmed"),
            "vehicle_part": enriched.get("vehicle_part", "unknown vehicle part"),
            "part_confidence": enriched.get("part_confidence", 0.40),
            "localization_method": enriched.get(
                "localization_method",
                "rule_based_bbox",
            ),
            "part_bbox": enriched.get("part_bbox"),
            "bbox": enriched.get("bbox"),
            "has_mask": enriched.get("has_mask", False),
        })
    return items


def persist_single_inspection(
    *,
    vehicle_id: str,
    view: str,
    detections: list[dict],
    response_body: dict[str, Any],
) -> str:
    """Save a single-image inspection and return inspection_id."""
    try:
        normalized_view = normalize_view_label(view) if view else "unknown"
    except ValueError:
        normalized_view = "unknown"

    inspection_id = str(uuid.uuid4())
    damages = _damages_from_detections(detections, view=normalized_view)
    severity = _overall_severity_from_damages(damages)
    combined_report = build_single_report_for_storage(detections, normalized_view)

    storage_body = {
        **response_body,
        "combined_report": combined_report,
        "vehicle_level_summary": {
            "total_damages": len(damages),
            "views_inspected": [normalized_view],
            "overall_severity": severity,
            "fleet_status": combined_report.get("suggested_action", ""),
        },
    }

    save_inspection(
        inspection_id=inspection_id,
        vehicle_id=vehicle_id,
        severity=severity,
        damages=damages,
        views_inspected=[normalized_view],
        inspection_type="single",
        report_json=storage_body,
    )
    logger.info(
        "Saved single inspection %s for vehicle %s",
        inspection_id,
        vehicle_id or "UNASSIGNED",
    )
    return inspection_id


def persist_multiview_inspection(
    *,
    inspection_id: str,
    vehicle_id: str,
    view_results: list[dict],
    combined_report: dict[str, Any],
    response_body: dict[str, Any],
    robot_metadata: dict[str, Any] | None = None,
) -> None:
    """Save a multi-view inspection record."""
    damages = list(combined_report.get("items") or [])
    severity = combined_report.get("overall_severity", "None")
    views_inspected = sorted({vr["view"] for vr in view_results})

    storage_body = dict(response_body)
    metadata_record = dict(robot_metadata) if robot_metadata else None

    if metadata_record:
        metadata_record["mission_completed_at"] = (
            datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        )
        storage_body["robot_mission"] = metadata_record
        response_body["robot_mission"] = metadata_record

    save_inspection(
        inspection_id=inspection_id,
        vehicle_id=vehicle_id,
        severity=severity,
        damages=damages,
        views_inspected=views_inspected,
        inspection_type="multiview",
        report_json=storage_body,
        metadata_json=metadata_record,
    )
    logger.info(
        "Saved multiview inspection %s for vehicle %s",
        inspection_id,
        vehicle_id or "UNASSIGNED",
    )


def build_single_report_for_storage(
    detections: list[dict],
    view: str,
) -> dict[str, Any]:
    """Minimal combined-style report for single-image storage."""
    view_result = {"view": view, "detections": detections}
    return generate_combined_report([view_result])
