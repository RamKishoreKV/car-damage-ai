"""
Rule-based vehicle part localization from YOLO bbox + capture view.
Deterministic — no second ML model.
"""

from __future__ import annotations

from typing import Any

LOCALIZATION_METHOD = "rule_based_bbox"

SUPPORTED_VIEWS = frozenset({
    "front",
    "rear",
    "left_side",
    "right_side",
    "wheel_closeup",
    "damage_closeup",
    "unknown",
})

GLASS_DAMAGE_TYPES = frozenset({"crack", "glass shatter", "glass_shatter"})
LAMP_DAMAGE_TYPES = frozenset({"lamp broken", "lamp_broken"})
TIRE_DAMAGE_TYPES = frozenset({"tire flat", "tire_flat"})


def _normalize_damage_type(damage_type: str) -> str:
    return (damage_type or "").lower().replace("_", " ")


def _normalize_view(vehicle_view: str) -> str:
    view = (vehicle_view or "unknown").lower().strip().replace("-", "_").replace(" ", "_")
    aliases = {
        "left": "left_side",
        "right": "right_side",
        "wheel": "wheel_closeup",
        "damage": "damage_closeup",
    }
    return aliases.get(view, view if view in SUPPORTED_VIEWS else "unknown")


def _bbox_center(bbox: list, image_width: int, image_height: int) -> tuple[float, float] | None:
    if not bbox or len(bbox) != 4 or not image_width or not image_height:
        return None
    x1, y1, x2, y2 = bbox
    cx = ((x1 + x2) / 2) / image_width
    cy = ((y1 + y2) / 2) / image_height
    return cx, cy


def _grid_zone(cx: float, cy: float) -> tuple[str, str]:
    vertical = "upper" if cy < 0.33 else "lower" if cy > 0.66 else "middle"
    horizontal = "left" if cx < 0.33 else "right" if cx > 0.66 else "middle"
    return vertical, horizontal


def _horizontal_third(cx: float) -> str:
    if cx < 0.33:
        return "front"
    if cx < 0.66:
        return "middle"
    return "rear"


def _part_confidence(clarity: str, cx: float, cy: float) -> float:
    """Deterministic part-confidence from zone clarity and center proximity."""
    base = {"high": 0.80, "medium": 0.72, "low": 0.58}.get(clarity, 0.55)
    edge_penalty = 0.0
    for coord in (cx, cy):
        dist_edge = min(coord, 1.0 - coord)
        if dist_edge < 0.08:
            edge_penalty += 0.04
    return round(max(0.40, min(0.92, base - edge_penalty)), 2)


# When side assignment is uncertain, prefer assembly-level labels over left/right.
_SIDE_NEUTRAL_LABELS = {
    "left headlight": "headlight assembly",
    "right headlight": "headlight assembly",
    "left taillight": "taillight assembly",
    "right taillight": "taillight assembly",
    "left front fender": "front fender area",
    "right front fender": "front fender area",
    "left rear wheel": "rear wheel area",
    "right rear wheel": "rear wheel area",
    "left front wheel": "front wheel area",
    "right front wheel": "front wheel area",
}


def _bbox_coverage(bbox: list, image_width: int, image_height: int) -> float:
    if not bbox or len(bbox) != 4 or not image_width or not image_height:
        return 0.0
    x1, y1, x2, y2 = bbox
    box_area = max(0, x2 - x1) * max(0, y2 - y1)
    return box_area / (image_width * image_height)


def _is_cropped_or_closeup(
    image_width: int,
    image_height: int,
    bbox: list | None,
) -> bool:
    """True when the frame likely shows a cropped or close-up capture."""
    if not image_width or not image_height:
        return True

    aspect = image_width / image_height
    if 0.85 <= aspect <= 1.15:
        return True

    coverage = _bbox_coverage(bbox or [], image_width, image_height)
    return coverage >= 0.35


def _should_avoid_side_claims(
    view: str,
    image_width: int,
    image_height: int,
    bbox: list | None,
    part_confidence: float,
) -> bool:
    if view in ("wheel_closeup", "damage_closeup", "unknown"):
        return True
    if view not in ("front", "rear"):
        return False
    if part_confidence < 0.68:
        return True
    return _is_cropped_or_closeup(image_width, image_height, bbox)


def _apply_side_caution(part: str, avoid_side: bool) -> str:
    if not avoid_side:
        return part
    return _SIDE_NEUTRAL_LABELS.get(part, part)


def _result(part: str, clarity: str, cx: float, cy: float) -> dict[str, Any]:
    return {
        "vehicle_part": part,
        "part_confidence": _part_confidence(clarity, cx, cy),
        "localization_method": LOCALIZATION_METHOD,
    }


def _finalize_part_result(
    result: dict[str, Any],
    *,
    view: str,
    image_width: int,
    image_height: int,
    bbox: list | None,
) -> dict[str, Any]:
    avoid_side = _should_avoid_side_claims(
        view,
        image_width,
        image_height,
        bbox,
        float(result.get("part_confidence", 0)),
    )
    return {
        **result,
        "vehicle_part": _apply_side_caution(result["vehicle_part"], avoid_side),
    }


def _pick_glass_or_panel(
    damage_type: str,
    glass_part: str,
    panel_part: str,
) -> str:
    if _normalize_damage_type(damage_type) in GLASS_DAMAGE_TYPES:
        return glass_part
    return panel_part


def _localize_front(cx: float, cy: float, damage_type: str) -> dict[str, Any]:
    vertical, horizontal = _grid_zone(cx, cy)
    dtype = _normalize_damage_type(damage_type)

    if vertical == "upper" and horizontal == "middle":
        part = _pick_glass_or_panel(damage_type, "windshield", "hood")
        return _result(part, "medium", cx, cy)

    if vertical == "upper" and horizontal == "left":
        if dtype in LAMP_DAMAGE_TYPES:
            return _result("left headlight", "high", cx, cy)
        return _result("left headlight", "medium", cx, cy)

    if vertical == "upper" and horizontal == "right":
        if dtype in LAMP_DAMAGE_TYPES:
            return _result("right headlight", "high", cx, cy)
        return _result("right headlight", "medium", cx, cy)

    if vertical == "middle" and horizontal == "middle":
        return _result("grille", "high", cx, cy)

    if vertical == "lower" and horizontal == "middle":
        return _result("front bumper", "high", cx, cy)

    if vertical == "lower" and horizontal == "left":
        if dtype in TIRE_DAMAGE_TYPES:
            return _result("left front wheel", "high", cx, cy)
        return _result("left front fender", "medium", cx, cy)

    if vertical == "lower" and horizontal == "right":
        if dtype in TIRE_DAMAGE_TYPES:
            return _result("right front wheel", "high", cx, cy)
        return _result("right front fender", "medium", cx, cy)

    if vertical == "middle" and horizontal == "left":
        return _result("left headlight", "medium", cx, cy)
    if vertical == "middle" and horizontal == "right":
        return _result("right headlight", "medium", cx, cy)

    return _result("front bumper", "low", cx, cy)


def _localize_rear(cx: float, cy: float, damage_type: str) -> dict[str, Any]:
    vertical, horizontal = _grid_zone(cx, cy)
    dtype = _normalize_damage_type(damage_type)

    if vertical == "upper" and horizontal == "middle":
        part = _pick_glass_or_panel(damage_type, "rear windshield", "trunk")
        return _result(part, "medium", cx, cy)

    if vertical == "upper" and horizontal == "left":
        if dtype in LAMP_DAMAGE_TYPES:
            return _result("left taillight", "high", cx, cy)
        return _result("left taillight", "medium", cx, cy)

    if vertical == "upper" and horizontal == "right":
        if dtype in LAMP_DAMAGE_TYPES:
            return _result("right taillight", "high", cx, cy)
        return _result("right taillight", "medium", cx, cy)

    if vertical == "middle" and horizontal == "middle":
        return _result("trunk lid", "high", cx, cy)

    if vertical == "lower" and horizontal == "middle":
        return _result("rear bumper", "high", cx, cy)

    if vertical == "lower" and horizontal == "left":
        return _result("left rear wheel", "medium", cx, cy)
    if vertical == "lower" and horizontal == "right":
        return _result("right rear wheel", "medium", cx, cy)

    if vertical == "middle" and horizontal == "left":
        return _result("left taillight", "medium", cx, cy)
    if vertical == "middle" and horizontal == "right":
        return _result("right taillight", "medium", cx, cy)

    return _result("rear bumper", "low", cx, cy)


def _localize_left_side(cx: float, cy: float, damage_type: str) -> dict[str, Any]:
    dtype = _normalize_damage_type(damage_type)

    if cy > 0.66:
        return _result("left wheel area", "high", cx, cy)
    if cy < 0.33:
        return _result("side window", "high", cx, cy)

    third = _horizontal_third(cx)
    if third == "front":
        if dtype == "dent" and cy < 0.5:
            return _result("left front fender", "medium", cx, cy)
        return _result("left front door", "medium", cx, cy)
    if third == "middle":
        return _result("left rear door", "medium", cx, cy)
    return _result("left rear quarter panel", "medium", cx, cy)


def _localize_right_side(cx: float, cy: float, damage_type: str) -> dict[str, Any]:
    dtype = _normalize_damage_type(damage_type)

    if cy > 0.66:
        return _result("right wheel area", "high", cx, cy)
    if cy < 0.33:
        return _result("side window", "high", cx, cy)

    third = _horizontal_third(cx)
    if third == "front":
        if dtype == "dent" and cy < 0.5:
            return _result("right front fender", "medium", cx, cy)
        return _result("right front door", "medium", cx, cy)
    if third == "middle":
        return _result("right rear door", "medium", cx, cy)
    return _result("right rear quarter panel", "medium", cx, cy)


def _localize_wheel_closeup(cx: float, cy: float, damage_type: str) -> dict[str, Any]:
    dtype = _normalize_damage_type(damage_type)
    if dtype in TIRE_DAMAGE_TYPES or cy > 0.55:
        return _result("tire", "high", cx, cy)
    return _result("wheel", "medium", cx, cy)


def _localize_unknown_part() -> dict[str, Any]:
    return {
        "vehicle_part": "unknown vehicle part",
        "part_confidence": 0.40,
        "localization_method": LOCALIZATION_METHOD,
    }


def localize_vehicle_part(
    detection: dict,
    image_width: int,
    image_height: int,
    vehicle_view: str,
) -> dict[str, Any]:
    """
    Infer vehicle part from bbox position, image size, and capture view.
    Returns vehicle_part, part_confidence, localization_method.
    """
    view = _normalize_view(vehicle_view)

    if view in ("damage_closeup", "unknown"):
        return _localize_unknown_part()

    center = _bbox_center(detection.get("bbox") or [], image_width, image_height)
    if center is None:
        return _localize_unknown_part()

    cx, cy = center
    damage_type = detection.get("damage_type", "")

    bbox = detection.get("bbox") or []

    if view == "front":
        return _finalize_part_result(
            _localize_front(cx, cy, damage_type),
            view=view,
            image_width=image_width,
            image_height=image_height,
            bbox=bbox,
        )
    if view == "rear":
        return _finalize_part_result(
            _localize_rear(cx, cy, damage_type),
            view=view,
            image_width=image_width,
            image_height=image_height,
            bbox=bbox,
        )
    if view == "left_side":
        return _localize_left_side(cx, cy, damage_type)
    if view == "right_side":
        return _localize_right_side(cx, cy, damage_type)
    if view == "wheel_closeup":
        return _localize_wheel_closeup(cx, cy, damage_type)

    return _localize_unknown_part()


def enrich_detections_with_parts(
    detections: list[dict],
    image_width: int,
    image_height: int,
    vehicle_view: str,
) -> list[dict]:
    """Attach vehicle_part fields to each detection dict."""
    enriched: list[dict] = []
    for det in detections or []:
        part_info = localize_vehicle_part(det, image_width, image_height, vehicle_view)
        enriched.append({**det, **part_info})
    return enriched


def format_part_label(vehicle_part: str) -> str:
    """Title-case a vehicle part slug for display."""
    if not vehicle_part:
        return "Unknown Vehicle Part"
    return " ".join(word.capitalize() for word in vehicle_part.split())


def format_damage_on_part(damage_type: str, vehicle_part: str) -> str:
    """e.g. 'Dent detected on front bumper'."""
    damage = (damage_type or "damage").replace("_", " ").capitalize()
    part = format_part_label(vehicle_part)
    return f"{damage} detected on {part}."
