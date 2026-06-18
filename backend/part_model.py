"""
Optional vehicle part detection/segmentation model integration (Phase 6).

Runs a second YOLO model when backend/model/vehicle_parts.pt is present.
Maps damage detections to vehicle parts via mask/bbox overlap; falls back to
rule-based localization in part_localizer.py when unavailable.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import numpy as np

from part_localizer import localize_vehicle_part

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_PART_MODEL_PATH = BASE_DIR / "model" / "vehicle_parts.pt"

MIN_OVERLAP_IOU = 0.10
PART_MODEL_METHOD = "part_model_overlap"

_part_model = None
_part_model_load_attempted = False
_missing_model_warned = False

VEHICLE_PART_CLASSES = [
    "front_bumper",
    "rear_bumper",
    "hood",
    "trunk",
    "windshield",
    "rear_windshield",
    "front_left_door",
    "front_right_door",
    "rear_left_door",
    "rear_right_door",
    "left_fender",
    "right_fender",
    "left_quarter_panel",
    "right_quarter_panel",
    "left_headlight",
    "right_headlight",
    "left_taillight",
    "right_taillight",
    "wheel",
    "tire",
    "mirror",
    "roof",
    "side_window",
    "unknown",
]

PART_DISPLAY_LABELS: dict[str, str] = {
    "front_bumper": "front bumper",
    "rear_bumper": "rear bumper",
    "hood": "hood",
    "trunk": "trunk",
    "windshield": "windshield",
    "rear_windshield": "rear windshield",
    "front_left_door": "left front door",
    "front_right_door": "right front door",
    "rear_left_door": "left rear door",
    "rear_right_door": "right rear door",
    "left_fender": "left front fender",
    "right_fender": "right front fender",
    "left_quarter_panel": "left rear quarter panel",
    "right_quarter_panel": "right rear quarter panel",
    "left_headlight": "left headlight",
    "right_headlight": "right headlight",
    "left_taillight": "left taillight",
    "right_taillight": "right taillight",
    "wheel": "wheel",
    "tire": "tire",
    "mirror": "mirror",
    "roof": "roof",
    "side_window": "side window",
    "unknown": "unknown vehicle part",
}


def is_vehicle_part_model_enabled() -> bool:
    return os.getenv("USE_VEHICLE_PART_MODEL", "true").lower() in ("1", "true", "yes")


def get_vehicle_part_model_path() -> Path:
    raw = os.getenv("VEHICLE_PART_MODEL_PATH", "").strip()
    if raw:
        path = Path(raw)
        if not path.is_absolute():
            path = BASE_DIR / path
        return path
    return DEFAULT_PART_MODEL_PATH


def vehicle_part_model_file_exists() -> bool:
    path = get_vehicle_part_model_path()
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def _warn_missing_model_once() -> None:
    global _missing_model_warned
    if _missing_model_warned:
        return
    _missing_model_warned = True
    logger.warning(
        "Vehicle part model not found; using rule-based localization. "
        "Place weights at %s to enable part model overlap.",
        get_vehicle_part_model_path(),
    )


def _get_inference_device() -> str | int:
    try:
        import torch

        if torch.cuda.is_available():
            return 0
    except Exception:
        pass
    return "cpu"


def load_vehicle_part_model():
    """Load and cache the optional vehicle part YOLO model. Returns None if unavailable."""
    global _part_model, _part_model_load_attempted

    if not is_vehicle_part_model_enabled():
        return None

    if _part_model is not None:
        return _part_model

    if _part_model_load_attempted:
        return None

    _part_model_load_attempted = True
    model_path = get_vehicle_part_model_path()

    if not model_path.is_file():
        _warn_missing_model_once()
        return None

    try:
        from ultralytics import YOLO

        device = _get_inference_device()
        logger.info("Loading vehicle part model from %s on device %s", model_path, device)
        _part_model = YOLO(str(model_path))
        logger.info("Vehicle part model ready")
        return _part_model
    except Exception:
        logger.exception("Failed to load vehicle part model; using rule-based localization")
        _part_model = None
        return None


def get_part_model_status() -> dict[str, Any]:
    enabled = is_vehicle_part_model_enabled()
    model_path = get_vehicle_part_model_path()
    file_exists = vehicle_part_model_file_exists()

    if enabled and file_exists and _part_model is None and not _part_model_load_attempted:
        load_vehicle_part_model()

    return {
        "enabled": enabled,
        "model_available": enabled and file_exists,
        "model_loaded": _part_model is not None,
        "model_path": str(model_path),
        "classes": list(VEHICLE_PART_CLASSES),
    }


def normalize_part_label(label: str) -> str:
    """Map model class slug to human-readable vehicle part label."""
    if not label:
        return PART_DISPLAY_LABELS["unknown"]

    key = str(label).lower().strip().replace("-", "_").replace(" ", "_")
    if key in PART_DISPLAY_LABELS:
        return PART_DISPLAY_LABELS[key]

    for class_name, display in PART_DISPLAY_LABELS.items():
        if class_name.replace("_", " ") == key.replace("_", " "):
            return display

    return key.replace("_", " ")


def bbox_iou(box_a: list, box_b: list) -> float:
    """Intersection-over-union for axis-aligned boxes [x1, y1, x2, y2]."""
    if not box_a or not box_b or len(box_a) != 4 or len(box_b) != 4:
        return 0.0

    ax1, ay1, ax2, ay2 = [float(v) for v in box_a]
    bx1, by1, bx2, by2 = [float(v) for v in box_b]

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)

    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter_area
    if union <= 0:
        return 0.0
    return inter_area / union


def _align_masks(mask_a: np.ndarray, mask_b: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if mask_a.shape == mask_b.shape:
        return mask_a, mask_b

    try:
        import cv2

        target_h = max(mask_a.shape[0], mask_b.shape[0])
        target_w = max(mask_a.shape[1], mask_b.shape[1])

        def resize_mask(mask: np.ndarray) -> np.ndarray:
            if mask.shape == (target_h, target_w):
                return mask
            return cv2.resize(
                mask.astype(np.float32),
                (target_w, target_h),
                interpolation=cv2.INTER_LINEAR,
            )

        return resize_mask(mask_a), resize_mask(mask_b)
    except Exception:
        smaller, larger = (
            (mask_a, mask_b) if mask_a.size <= mask_b.size else (mask_b, mask_a)
        )
        flat = np.zeros_like(larger, dtype=bool)
        flat[: smaller.shape[0], : smaller.shape[1]] = smaller > 0.5
        if smaller is mask_a:
            return flat, larger > 0.5
        return larger > 0.5, flat


def mask_iou(mask_a: np.ndarray | None, mask_b: np.ndarray | None) -> float:
    """IoU between two segmentation masks."""
    if mask_a is None or mask_b is None:
        return 0.0

    a = np.asarray(mask_a) > 0.5
    b = np.asarray(mask_b) > 0.5
    if a.size == 0 or b.size == 0:
        return 0.0

    a, b = _align_masks(a, b)
    intersection = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    if union <= 0:
        return 0.0
    return float(intersection / union)


def extract_damage_masks_from_yolo(yolo_result, detection_count: int) -> list[np.ndarray | None]:
    """Read segmentation masks from a damage YOLO result without changing inference."""
    masks: list[np.ndarray | None] = [None] * detection_count
    if yolo_result is None or yolo_result.masks is None or detection_count == 0:
        return masks

    try:
        for index in range(min(detection_count, len(yolo_result.masks.data))):
            mask = yolo_result.masks.data[index].cpu().numpy()
            masks[index] = mask if mask.size > 0 else None
    except Exception:
        logger.exception("Failed to extract damage masks for part matching")

    return masks


def _build_part_detections_from_yolo(result) -> list[dict[str, Any]]:
    detections: list[dict[str, Any]] = []
    if result is None or result.boxes is None or len(result.boxes) == 0:
        return detections

    names = result.names or {}
    boxes = result.boxes
    has_masks = result.masks is not None and len(result.masks) > 0

    for index in range(len(boxes)):
        xyxy = boxes.xyxy[index].cpu().numpy().tolist()
        confidence = float(boxes.conf[index].cpu().numpy())
        class_id = int(boxes.cls[index].cpu().numpy())
        raw_label = str(names.get(class_id, f"class_{class_id}"))

        mask = None
        has_mask = False
        if has_masks and index < len(result.masks.data):
            mask_arr = result.masks.data[index].cpu().numpy()
            has_mask = bool(mask_arr.size > 0 and mask_arr.sum() > 0)
            mask = mask_arr if has_mask else None

        detections.append(
            {
                "part_class": raw_label,
                "confidence": round(confidence, 4),
                "bbox": [int(round(v)) for v in xyxy],
                "has_mask": has_mask,
                "mask": mask,
            }
        )

    return detections


def run_part_inference(image_path: Path | str) -> list[dict[str, Any]]:
    """
    Run optional vehicle part model on an image.
    Returns empty list when disabled, missing, or on failure.
    """
    if not is_vehicle_part_model_enabled():
        return []

    model = load_vehicle_part_model()
    if model is None:
        return []

    try:
        device = _get_inference_device()
        results = model.predict(source=str(image_path), device=device, verbose=False)
        result = results[0] if results else None
        return _build_part_detections_from_yolo(result)
    except Exception:
        logger.exception("Vehicle part model inference failed; using rule-based localization")
        return []


def match_damage_to_vehicle_part(
    damage_detection: dict[str, Any],
    part_detections: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Return the best overlapping part detection, or None if IoU is below threshold."""
    if not part_detections:
        return None

    damage_bbox = damage_detection.get("bbox") or []
    damage_mask = damage_detection.get("_damage_mask")
    damage_has_mask = bool(damage_detection.get("has_mask")) and damage_mask is not None

    best_part: dict[str, Any] | None = None
    best_iou = 0.0

    for part in part_detections:
        part_bbox = part.get("bbox") or []
        part_mask = part.get("mask")
        part_has_mask = bool(part.get("has_mask")) and part_mask is not None

        if damage_has_mask and part_has_mask:
            overlap = mask_iou(damage_mask, part_mask)
        else:
            overlap = bbox_iou(damage_bbox, part_bbox)

        if overlap > best_iou:
            best_iou = overlap
            best_part = part

    if best_part is None or best_iou < MIN_OVERLAP_IOU:
        return None

    return {
        **best_part,
        "overlap_iou": round(best_iou, 4),
    }


def get_part_localization(
    damage_detection: dict[str, Any],
    part_detections: list[dict[str, Any]],
    image_size: tuple[int, int],
    vehicle_view: str,
) -> dict[str, Any]:
    """
    Prefer part-model overlap; fall back to rule-based localization.
    image_size: (width, height)
    """
    image_width, image_height = image_size
    match = match_damage_to_vehicle_part(damage_detection, part_detections)

    if match is not None:
        return {
            "vehicle_part": normalize_part_label(match.get("part_class", "unknown")),
            "part_confidence": float(match.get("confidence", 0)),
            "localization_method": PART_MODEL_METHOD,
            "part_bbox": match.get("bbox"),
        }

    fallback = localize_vehicle_part(
        damage_detection,
        image_width,
        image_height,
        vehicle_view,
    )
    return {
        **fallback,
        "part_bbox": None,
    }


def enrich_detections_with_part_model(
    damage_detections: list[dict],
    part_detections: list[dict[str, Any]],
    image_width: int,
    image_height: int,
    vehicle_view: str,
) -> list[dict]:
    """Attach vehicle part fields to each damage detection."""
    enriched: list[dict] = []
    for det in damage_detections or []:
        part_info = get_part_localization(
            det,
            part_detections,
            (image_width, image_height),
            vehicle_view,
        )
        cleaned = {k: v for k, v in det.items() if k != "_damage_mask"}
        enriched.append({**cleaned, **part_info})
    return enriched
