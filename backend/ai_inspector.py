"""
Vision-Language Inspection Assistant (Phase 4).

Converts grounded YOLO detection context into natural-language inspection summaries.
Optional Ollama local LLM; falls back to rule-based summaries when disabled or unavailable.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx

from inspection_report import (
    calculate_damage_severity,
    generate_combined_report,
    normalize_view_label,
)

logger = logging.getLogger(__name__)

OLLAMA_TIMEOUT_SECONDS = 60.0

VALID_FLEET_DECISIONS = frozenset({
    "Safe to Operate",
    "Maintenance Review Recommended",
    "Do Not Deploy",
})

STRUCTURAL_DAMAGE_TYPES = frozenset({
    "crack",
    "glass shatter",
    "lamp broken",
    "tire flat",
})


def is_ai_inspector_enabled() -> bool:
    return os.getenv("AI_INSPECTOR_ENABLED", "false").lower() in ("1", "true", "yes")


def _ollama_base_url() -> str:
    return os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")


def _ollama_model() -> str:
    return os.getenv("OLLAMA_MODEL", "qwen2.5:3b-instruct")


def validate_inspection_context(context: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize inspection context."""
    if not isinstance(context, dict):
        raise ValueError("Context must be a JSON object.")

    mode = str(context.get("mode", "single")).lower()
    if mode not in ("single", "multiview"):
        raise ValueError("mode must be 'single' or 'multiview'.")

    views = context.get("views_inspected") or []
    if not isinstance(views, list):
        raise ValueError("views_inspected must be a list.")

    detections = context.get("detections") or []
    if not isinstance(detections, list):
        raise ValueError("detections must be a list.")

    for i, det in enumerate(detections):
        if not isinstance(det, dict):
            raise ValueError(f"detections[{i}] must be an object")
        if "damage_type" not in det:
            raise ValueError(f"detections[{i}] missing damage_type")

    return {
        "vehicle_id": str(context.get("vehicle_id") or "UNASSIGNED"),
        "inspection_id": str(context.get("inspection_id") or ""),
        "mode": mode,
        "views_inspected": [str(v) for v in views],
        "detections": detections,
        "overall_severity": str(context.get("overall_severity") or "None"),
        "fleet_status": str(context.get("fleet_status") or ""),
    }


def build_context_from_single(
    *,
    vehicle_id: str,
    inspection_id: str | None,
    view: str,
    detections: list[dict],
) -> dict[str, Any]:
    """Build AI context from a single-image inspection."""
    try:
        normalized_view = normalize_view_label(view) if view else "unknown"
    except ValueError:
        normalized_view = "unknown"

    combined = generate_combined_report([{"view": normalized_view, "detections": detections}])
    damages = []
    for det in detections:
        dtype = det.get("damage_type", "unknown")
        conf = float(det.get("confidence", 0))
        damages.append({
            "view": normalized_view,
            "damage_type": dtype,
            "confidence": conf,
            "severity": calculate_damage_severity(dtype, conf),
            "verification_required": det.get(
                "verification_required",
                conf < 0.40,
            ),
            "vehicle_part": det.get("vehicle_part", "unknown vehicle part"),
            "part_confidence": det.get("part_confidence", 0.40),
            "localization_method": det.get(
                "localization_method",
                "rule_based_bbox",
            ),
            "bbox": det.get("bbox"),
        })

    overall = combined.get("overall_severity", "None")
    fleet_status = _fleet_status_from_severity(overall, len(damages))

    return {
        "vehicle_id": vehicle_id.strip() or "UNASSIGNED",
        "inspection_id": inspection_id or "",
        "mode": "single",
        "views_inspected": [normalized_view],
        "detections": damages,
        "overall_severity": overall,
        "fleet_status": fleet_status,
    }


def build_context_from_multiview(
    *,
    vehicle_id: str,
    inspection_id: str,
    view_results: list[dict],
    combined_report: dict[str, Any],
    vehicle_level_summary: dict[str, Any],
) -> dict[str, Any]:
    """Build AI context from a multi-view inspection."""
    return {
        "vehicle_id": vehicle_id.strip() or "UNASSIGNED",
        "inspection_id": inspection_id,
        "mode": "multiview",
        "views_inspected": vehicle_level_summary.get("views_inspected")
        or sorted({vr["view"] for vr in view_results}),
        "detections": list(combined_report.get("items") or []),
        "overall_severity": combined_report.get("overall_severity", "None"),
        "fleet_status": vehicle_level_summary.get("fleet_status", ""),
    }


def _fleet_status_from_severity(overall_severity: str, total_damages: int) -> str:
    if total_damages == 0:
        return "Ready for Service"
    if overall_severity == "High":
        return "Hold for Manual Inspection"
    if overall_severity == "Medium":
        return "Maintenance Review Recommended"
    return "Operational with Minor Damage"


def _fleet_decision(overall_severity: str, fleet_status: str) -> str:
    if overall_severity == "High" or "Hold" in fleet_status:
        return "Do Not Deploy"
    if overall_severity == "Medium" or "Maintenance" in fleet_status:
        return "Maintenance Review Recommended"
    return "Safe to Operate"


def _format_detection_lines(detections: list[dict]) -> str:
    if not detections:
        return "No damage detections were provided by the vision system."
    lines = []
    for i, det in enumerate(detections, start=1):
        view = str(det.get("view", "unknown")).replace("_", " ")
        dtype = str(det.get("damage_type", "unknown")).replace("_", " ")
        part = str(det.get("vehicle_part", "")).replace("_", " ")
        conf = det.get("confidence")
        conf_str = f"{float(conf) * 100:.1f}%" if conf is not None else "n/a"
        severity = det.get("severity", "Low")
        if part and part != "unknown vehicle part":
            lines.append(
                f"{i}. {dtype} on {part} — confidence {conf_str}, severity {severity}"
            )
        else:
            lines.append(
                f"{i}. [{view}] {dtype} — confidence {conf_str}, severity {severity}"
            )
    return "\n".join(lines)


def build_inspection_prompt(context: dict[str, Any]) -> str:
    """Build a grounded prompt for the local LLM."""
    ctx = validate_inspection_context(context)
    detection_block = _format_detection_lines(ctx["detections"])
    views = ", ".join(v.replace("_", " ") for v in ctx["views_inspected"]) or "not specified"

    return f"""You are a professional fleet vehicle inspection assistant.
Write a concise inspection summary using ONLY the detections listed below.
Each detection includes a localized vehicle_part when available — prefer phrasing like
"Dent detected on the left front door" instead of generic view-only descriptions.
Do NOT invent damage that is not listed. Do NOT estimate repair costs.
Do NOT claim structural damage unless crack, glass shatter, lamp broken, or tire flat
is listed with High severity.
Use cautious, professional language suitable for fleet maintenance teams.
If overall severity is Medium or High, recommend technician review.

Vehicle ID: {ctx["vehicle_id"]}
Inspection ID: {ctx["inspection_id"] or "n/a"}
Inspection mode: {ctx["mode"]}
Views inspected: {views}
Overall severity (from rules): {ctx["overall_severity"]}
Fleet status (from rules): {ctx["fleet_status"]}

YOLO detections (ground truth — do not add others):
{detection_block}

Respond with valid JSON only, no markdown, using this exact schema:
{{
  "summary": "2-4 sentence professional inspection summary",
  "risk_assessment": "1-2 sentences on operational risk based only on listed detections",
  "recommended_next_steps": ["step 1", "step 2"],
  "fleet_decision": "Safe to Operate" | "Maintenance Review Recommended" | "Do Not Deploy"
}}"""


def fallback_rule_based_summary(context: dict[str, Any]) -> dict[str, Any]:
    """Deterministic summary when Ollama is disabled or unavailable."""
    ctx = validate_inspection_context(context)
    detections = ctx["detections"]
    overall = ctx["overall_severity"]
    fleet_status = ctx["fleet_status"]
    vehicle_id = ctx["vehicle_id"]
    views = ", ".join(v.replace("_", " ") for v in ctx["views_inspected"])

    if not detections:
        return {
            "enabled": True,
            "source": "fallback",
            "summary": (
                f"No supported damage classes were detected from the provided "
                f"image(s) for vehicle {vehicle_id}."
            ),
            "risk_assessment": (
                "The model did not report supported damage classes. Manual review "
                "may still be needed for unsupported damage types or poor image quality."
            ),
            "recommended_next_steps": [
                "Document the inspection result in fleet records.",
                "Review manually if collision history or image quality warrants it.",
            ],
            "fleet_decision": "Safe to Operate",
        }

    damage_types = sorted({str(d.get("damage_type", "damage")).replace("_", " ") for d in detections})
    high_items = [
        d for d in detections
        if d.get("severity") == "High" and not d.get("verification_required")
    ]
    structural_high = [
        d for d in high_items
        if str(d.get("damage_type", "")).lower().replace("_", " ") in STRUCTURAL_DAMAGE_TYPES
        or any(t in str(d.get("damage_type", "")).lower() for t in ("crack", "glass", "lamp", "tire"))
    ]

    summary = (
        f"Vehicle {vehicle_id} inspection ({ctx['mode']}) identified {len(detections)} "
        f"YOLO-reported damage finding(s) across {views}: {', '.join(damage_types)}. "
        f"Overall severity is assessed as {overall}."
    )

    if structural_high:
        risk = (
            "Elevated safety concern: high-severity crack, glass, lighting, or tire-related "
            "findings were reported. Technician review is recommended before deployment."
        )
    elif overall == "High":
        risk = (
            "Elevated operational risk based on high-severity or numerous reported findings. "
            "Technician review is recommended before returning the vehicle to service."
        )
    elif overall == "Medium":
        risk = (
            "Moderate operational risk. Findings warrant maintenance review and "
            "close-up confirmation by a technician."
        )
    else:
        risk = (
            "Low to moderate risk based on reported cosmetic or minor findings. "
            "Monitor during routine operations."
        )

    steps = []
    if overall in ("Medium", "High"):
        steps.append("Schedule technician review before fleet redeployment.")
    steps.append("Capture close-up photos of each reported damage area for maintenance records.")
    if structural_high:
        steps.append("Prioritize safety-related items (glass, tires, lighting, cracks) for inspection.")
    steps.append("Update fleet maintenance log with inspection ID and findings.")

    return {
        "enabled": True,
        "source": "fallback",
        "summary": summary,
        "risk_assessment": risk,
        "recommended_next_steps": steps,
        "fleet_decision": _fleet_decision(overall, fleet_status),
    }


def _extract_json_object(text: str) -> dict[str, Any]:
    """Parse JSON from LLM output, tolerating minor wrapping."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty LLM response")

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            raise ValueError("No JSON object found in LLM response") from None
        return json.loads(match.group())


def _normalize_llm_summary(parsed: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize LLM JSON into the API response shape."""
    ctx = validate_inspection_context(context)

    summary = str(parsed.get("summary", "")).strip()
    risk = str(parsed.get("risk_assessment", "")).strip()
    steps_raw = parsed.get("recommended_next_steps") or []
    decision = str(parsed.get("fleet_decision", "")).strip()

    if not summary:
        raise ValueError("LLM response missing summary")
    if not risk:
        raise ValueError("LLM response missing risk_assessment")
    if not isinstance(steps_raw, list) or not steps_raw:
        raise ValueError("LLM response missing recommended_next_steps")

    steps = [str(s).strip() for s in steps_raw if str(s).strip()]
    if not steps:
        raise ValueError("LLM recommended_next_steps is empty")

    if decision not in VALID_FLEET_DECISIONS:
        decision = _fleet_decision(ctx["overall_severity"], ctx["fleet_status"])

    # Enforce grounding: if no detections, force safe decision
    if not ctx["detections"]:
        decision = "Safe to Operate"

    return {
        "enabled": True,
        "source": "ollama",
        "summary": summary,
        "risk_assessment": risk,
        "recommended_next_steps": steps,
        "fleet_decision": decision,
    }


def _call_ollama(prompt: str) -> str:
    """Call Ollama generate API with timeout."""
    url = f"{_ollama_base_url()}/api/generate"
    payload = {
        "model": _ollama_model(),
        "prompt": prompt,
        "stream": False,
        "format": "json",
    }

    try:
        with httpx.Client(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
            response = client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.ConnectError as exc:
        raise ConnectionError("Ollama is not running or unreachable") from exc
    except httpx.TimeoutException as exc:
        raise TimeoutError(f"Ollama request timed out after {OLLAMA_TIMEOUT_SECONDS}s") from exc
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise RuntimeError(f"Ollama model not found: {_ollama_model()}") from exc
        raise RuntimeError(f"Ollama HTTP error: {exc.response.status_code}") from exc

    text = data.get("response", "")
    if not text:
        raise ValueError("Ollama returned an empty response")
    return text


def generate_ai_inspection_summary(context: dict[str, Any]) -> dict[str, Any]:
    """
    Generate an AI inspection summary from grounded YOLO context.
    Uses Ollama when enabled; falls back to rule-based summary on any failure.
    """
    try:
        ctx = validate_inspection_context(context)
    except ValueError as exc:
        logger.warning("Invalid AI inspection context: %s", exc)
        try:
            return fallback_rule_based_summary(context if isinstance(context, dict) else {})
        except Exception:
            return {
                "enabled": True,
                "source": "fallback",
                "summary": "Unable to generate inspection summary from the provided context.",
                "risk_assessment": "Review the rule-based inspection report below.",
                "recommended_next_steps": ["Consult the YOLO detection results and rule-based report."],
                "fleet_decision": "Maintenance Review Recommended",
            }

    if not is_ai_inspector_enabled():
        return fallback_rule_based_summary(ctx)

    try:
        prompt = build_inspection_prompt(ctx)
        raw = _call_ollama(prompt)
        parsed = _extract_json_object(raw)
        return _normalize_llm_summary(parsed, ctx)
    except (ConnectionError, TimeoutError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("Ollama AI summary failed, using fallback: %s", exc)
        return fallback_rule_based_summary(ctx)
    except Exception:
        logger.exception("Unexpected AI inspector error")
        return fallback_rule_based_summary(ctx)
