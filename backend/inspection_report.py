"""
Rule-based vehicle inspection report helpers for multi-view inspections.
Deterministic logic only — no LLM.
"""

from __future__ import annotations

from typing import Any

from part_localizer import format_damage_on_part, format_part_label

VALID_VIEW_LABELS = frozenset({
    "front",
    "rear",
    "left_side",
    "right_side",
    "wheel_closeup",
    "damage_closeup",
    "unknown",
})

VIEW_DISPLAY_NAMES = {
    "front": "front",
    "rear": "rear",
    "left_side": "left side",
    "right_side": "right side",
    "wheel_closeup": "wheel close-up",
    "damage_closeup": "damage close-up",
    "unknown": "unknown",
}

HIGH_RISK_TYPES = frozenset({
    "crack",
    "glass shatter",
    "lamp broken",
    "tire flat",
})

LOW_CONFIDENCE_THRESHOLD = 0.40


def is_low_confidence(confidence: float) -> bool:
    """True when model confidence is below the verification threshold."""
    return float(confidence or 0) < LOW_CONFIDENCE_THRESHOLD


def calculate_damage_severity(damage_type: str, confidence: float) -> str:
    """Map damage type and model confidence to Low / Medium / High severity."""
    normalized = (damage_type or "").lower().replace("_", " ")
    conf = float(confidence or 0)

    # Do not escalate severity from damage class alone when confidence is low.
    if conf < LOW_CONFIDENCE_THRESHOLD:
        return "Low"

    if normalized in HIGH_RISK_TYPES and conf >= 0.7:
        return "High"
    if normalized in HIGH_RISK_TYPES or conf >= 0.85:
        return "Medium"
    return "Low"


def enrich_detection(det: dict, *, view: str | None = None) -> dict:
    """Attach severity and verification metadata to a YOLO detection."""
    damage_type = det.get("damage_type", "unknown")
    confidence = float(det.get("confidence", 0))
    verification_required = is_low_confidence(confidence)
    severity = calculate_damage_severity(damage_type, confidence)

    enriched = {
        **det,
        "confidence": confidence,
        "severity": severity,
        "verification_required": verification_required,
        "confidence_tier": "low" if verification_required else "confirmed",
        "finding_type": "Potential Finding" if verification_required else "Confirmed Finding",
    }
    if view is not None:
        enriched["view"] = view
    return enriched


def normalize_view_label(view: str) -> str:
    """Normalize and validate a vehicle capture view label."""
    if not view or not str(view).strip():
        raise ValueError("View label is required for each image.")

    normalized = str(view).lower().strip().replace("-", "_").replace(" ", "_")

    aliases = {
        "left": "left_side",
        "right": "right_side",
        "wheel": "wheel_closeup",
        "tire": "wheel_closeup",
        "damage": "damage_closeup",
        "closeup": "damage_closeup",
        "close_up": "damage_closeup",
    }
    normalized = aliases.get(normalized, normalized)

    if normalized not in VALID_VIEW_LABELS:
        allowed = ", ".join(sorted(VALID_VIEW_LABELS))
        raise ValueError(
            f"Invalid view label '{view}'. Supported labels: {allowed}."
        )

    return normalized


def _capitalize_damage(damage_type: str) -> str:
    if not damage_type:
        return "Unknown"
    return damage_type.replace("_", " ").capitalize()


def _suggested_action_for_item(
    damage_type: str,
    severity: str,
    *,
    verification_required: bool = False,
    vehicle_part: str | None = None,
) -> str:
    dtype = _capitalize_damage(damage_type).lower()
    part_phrase = (
        f" on {format_part_label(vehicle_part)}"
        if vehicle_part and vehicle_part != "unknown vehicle part"
        else ""
    )

    if verification_required:
        return (
            f"Low-confidence {dtype} detection{part_phrase} — capture a closer photo "
            "to verify before escalating severity."
        )

    if severity == "High":
        if "glass" in dtype:
            return "Escalate for immediate glass and safety inspection before fleet release."
        if "tire" in dtype:
            return "Remove from active dispatch and inspect tire integrity before reuse."
        if "lamp" in dtype:
            return "Schedule lighting repair to maintain roadworthiness compliance."
        return "Prioritize technician review and document before returning to service."

    if severity == "Medium":
        if "scratch" in dtype:
            return "Inspect painted surface and consider cosmetic repair."
        if "dent" in dtype:
            return "Inspect panel alignment and schedule body repair if needed."
        return f"Schedule maintenance review for {dtype} and capture close-up photos."

    return f"Monitor {dtype} during routine inspections and repair if it worsens."


def _view_display(view: str) -> str:
    return VIEW_DISPLAY_NAMES.get(view, view.replace("_", " "))


def generate_view_summary(view: str, detections: list[dict]) -> str:
    """One-line summary for a single vehicle view."""
    display = _view_display(view)
    count = len(detections)

    if count == 0:
        return f"No model-detected damage on {display} view."

    confirmed = [
        d for d in detections
        if not d.get("verification_required", is_low_confidence(d.get("confidence", 0)))
    ]
    potential_count = count - len(confirmed)

    if len(confirmed) == 0:
        suffix = (
            f"{potential_count} low-confidence finding"
            f"{'s' if potential_count != 1 else ''} require verification."
        )
        return f"{suffix} on {display} view."

    if len(confirmed) == 1:
        det = confirmed[0]
        if det.get("vehicle_part"):
            summary = format_damage_on_part(
                det.get("damage_type", "damage"),
                det["vehicle_part"],
            ).rstrip(".")
        else:
            damage = _capitalize_damage(det.get("damage_type", "damage"))
            summary = f"{damage} detected on {display} view"
    else:
        part_labels = [
            format_part_label(d.get("vehicle_part") or _view_display(view))
            for d in confirmed[:3]
        ]
        extra = len(confirmed) - 3
        parts_text = ", ".join(part_labels)
        if extra > 0:
            parts_text += f", +{extra} more"
        summary = (
            f"{len(confirmed)} confirmed damage issues on "
            f"{parts_text}."
        )

    if potential_count > 0:
        summary += (
            f" {potential_count} potential finding"
            f"{'s' if potential_count != 1 else ''} require verification."
        )
    return summary


def _overall_severity_from_items(items: list[dict]) -> str:
    if not items:
        return "None"

    confirmed = [item for item in items if not item.get("verification_required")]
    if not confirmed:
        return "Low"

    severities = [item.get("severity", "Low") for item in confirmed]
    if "High" in severities or len(confirmed) >= 6:
        return "High"
    if "Medium" in severities or len(confirmed) >= 3:
        return "Medium"
    return "Low"


def _fleet_status_from_severity(severity: str, total_damages: int) -> str:
    if total_damages == 0:
        return "No Model-Detected Damage"
    if severity == "High":
        return "Hold for Manual Inspection"
    if severity == "Medium":
        return "Maintenance Review Recommended"
    return "Operational with Minor Damage"


def _fleet_action_from_severity(severity: str, total_damages: int) -> str:
    if total_damages == 0:
        return "No supported damage classes detected. Review manually if needed."
    if severity == "High":
        return (
            "Escalate for technician review before returning the vehicle "
            "to active fleet use."
        )
    if severity == "Medium":
        return "Maintenance review recommended before fleet redeployment."
    return "Document findings and continue routine fleet monitoring."


def generate_combined_report(all_view_results: list[dict]) -> dict[str, Any]:
    """
    Build a vehicle-level combined report from per-view inference results.

    Each view result should include: view, detections (list of dicts).
    """
    items: list[dict] = []

    for view_result in all_view_results:
        view = view_result.get("view", "unknown")
        for det in view_result.get("detections") or []:
            damage_type = det.get("damage_type", "unknown")
            confidence = float(det.get("confidence", 0))
            verification_required = is_low_confidence(confidence)
            severity = calculate_damage_severity(damage_type, confidence)
            items.append({
                "view": view,
                "damage_type": damage_type,
                "confidence": confidence,
                "severity": severity,
                "verification_required": verification_required,
                "confidence_tier": "low" if verification_required else "confirmed",
                "finding_type": (
                    "Potential Finding" if verification_required else "Confirmed Finding"
                ),
                "vehicle_part": det.get("vehicle_part", "unknown vehicle part"),
                "part_confidence": float(det.get("part_confidence", 0.40)),
                "localization_method": det.get(
                    "localization_method",
                    "rule_based_bbox",
                ),
                "suggested_action": _suggested_action_for_item(
                    damage_type,
                    severity,
                    verification_required=verification_required,
                    vehicle_part=det.get("vehicle_part"),
                ),
            })

    total_damages = len(items)
    views_with_detections = sorted({
        vr["view"] for vr in all_view_results if vr.get("detections")
    })
    views_inspected = sorted({vr["view"] for vr in all_view_results})
    overall_severity = _overall_severity_from_items(items)

    if total_damages == 0:
        summary = (
            f"No model-detected damage across {len(all_view_results)} vehicle view"
            f"{'s' if len(all_view_results) != 1 else ''}."
        )
    elif total_damages == 1 and items:
        item = items[0]
        summary = format_damage_on_part(
            item.get("damage_type", "damage"),
            item.get("vehicle_part", "unknown vehicle part"),
        ).rstrip(".")
    elif len(views_inspected) == 1:
        summary = (
            f"{total_damages} damage issue{'s' if total_damages != 1 else ''} "
            f"detected on {views_inspected[0]} view."
        )
    else:
        summary = (
            f"{total_damages} damage issue{'s' if total_damages != 1 else ''} "
            f"detected across {len(views_inspected)} vehicle views."
        )

    return {
        "summary": summary,
        "overall_severity": overall_severity,
        "suggested_action": _fleet_action_from_severity(overall_severity, total_damages),
        "items": items,
        "views_with_damage": views_with_detections,
    }


def build_vehicle_level_summary(
    all_view_results: list[dict],
    combined_report: dict[str, Any],
) -> dict[str, Any]:
    """Top-level vehicle summary for multi-view API response."""
    total_images = len(all_view_results)
    total_damages = len(combined_report.get("items") or [])
    views_inspected = sorted({vr["view"] for vr in all_view_results})
    overall_severity = combined_report.get("overall_severity", "None")

    return {
        "total_images": total_images,
        "total_damages": total_damages,
        "views_inspected": views_inspected,
        "overall_severity": overall_severity,
        "fleet_status": _fleet_status_from_severity(overall_severity, total_damages),
    }
