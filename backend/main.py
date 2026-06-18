"""
Car Damage Detection API — Phase 1 MVP
Local YOLOv11 segmentation inference via Ultralytics.

Model: harpreetsahota/car-dd-segmentation-yolov11 (auto-downloaded to backend/model/)
"""

import json
import logging
import os
import uuid
import asyncio
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fleet_persistence import persist_multiview_inspection, persist_single_inspection
from fleet_routes import router as fleet_router
from ai_routes import router as ai_router
from ai_inspector import (
    build_context_from_multiview,
    build_context_from_single,
    generate_ai_inspection_summary,
    is_ai_inspector_enabled,
)
from huggingface_hub import hf_hub_download
from database import init_db
from inspection_report import (
    build_vehicle_level_summary,
    enrich_detection,
    generate_combined_report,
    generate_view_summary,
    normalize_view_label,
)
from part_localizer import enrich_detections_with_parts
from part_model import (
    enrich_detections_with_part_model,
    extract_damage_masks_from_yolo,
    get_part_model_status,
    is_vehicle_part_model_enabled,
    run_part_inference,
)
from PIL import Image

# ---------------------------------------------------------------------------
# Paths & configuration
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "model"
MODEL_PATH = MODEL_DIR / "best.pt"
UPLOADS_DIR = BASE_DIR / "uploads"
OUTPUTS_DIR = BASE_DIR / "outputs"

HF_MODEL_REPO = "harpreetsahota/car-dd-segmentation-yolov11"
HF_MODEL_FILENAME = "best.pt"
MODEL_SOURCE = "local_huggingface_yolov11_car_damage"
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000").rstrip("/")

# Minimum expected size for best.pt (~125 MB on Hugging Face)
MIN_MODEL_BYTES = 50_000_000

MODEL_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/bmp",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="AutoInspect AI",
    description="AI-powered vehicle damage inspection API for fleet operations",
    version="4.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")
app.include_router(fleet_router)
app.include_router(ai_router)

_yolo_model = None
_inference_device: str | int = "cpu"


def _ai_inspector_requested(flag: str) -> bool:
    return str(flag).lower() in ("1", "true", "yes")


def _robot_mode_requested(flag: str) -> bool:
    return str(flag).lower() in ("1", "true", "yes")


def _parse_capture_sequence(raw: str) -> list[str] | None:
    """Parse capture sequence from JSON array or comma-separated view labels."""
    if not raw or not str(raw).strip():
        return None
    text = str(raw).strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(item) for item in parsed if str(item).strip()]
    except json.JSONDecodeError:
        pass
    return [part.strip() for part in text.split(",") if part.strip()]


async def _attach_ai_inspection(
    response_body: dict[str, Any],
    context: dict[str, Any],
    ai_inspector: str,
) -> None:
    if not is_ai_inspector_enabled() or not _ai_inspector_requested(ai_inspector):
        return
    try:
        response_body["ai_inspection"] = await asyncio.to_thread(
            generate_ai_inspection_summary, context
        )
    except Exception:
        logger.exception("Failed to attach AI inspection summary")
        from ai_inspector import fallback_rule_based_summary

        response_body["ai_inspection"] = fallback_rule_based_summary(context)


def get_inference_device() -> str | int:
    """Use NVIDIA GPU when available, otherwise CPU."""
    try:
        import torch

        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            logger.info("CUDA available — using GPU: %s", name)
            return 0
    except Exception as exc:
        logger.warning("Could not initialize CUDA, falling back to CPU: %s", exc)

    logger.info("Using CPU for inference")
    return "cpu"


def get_device_info() -> dict:
    """Return device details for health/status endpoints."""
    try:
        import torch

        if torch.cuda.is_available():
            return {
                "device": "cuda",
                "gpu_name": torch.cuda.get_device_name(0),
                "cuda_version": torch.version.cuda,
            }
    except Exception:
        pass
    return {"device": "cpu", "gpu_name": None, "cuda_version": None}


def model_file_valid() -> bool:
    """Return True when best.pt exists and is not corrupt/truncated."""
    try:
        return MODEL_PATH.is_file() and MODEL_PATH.stat().st_size >= MIN_MODEL_BYTES
    except OSError:
        return False


def ensure_model_downloaded() -> None:
    """
    Download YOLO weights from Hugging Face if missing locally.
    Raises HTTPException on failure.
    """
    if model_file_valid():
        logger.info("Local model already present at %s", MODEL_PATH)
        return

    if MODEL_PATH.exists() and not model_file_valid():
        logger.warning("Model file at %s appears corrupt — re-downloading", MODEL_PATH)
        MODEL_PATH.unlink(missing_ok=True)

    logger.info("Model download started from Hugging Face: %s", HF_MODEL_REPO)
    try:
        hf_hub_download(
            repo_id=HF_MODEL_REPO,
            filename=HF_MODEL_FILENAME,
            local_dir=str(MODEL_DIR),
            local_dir_use_symlinks=False,
        )
    except Exception as exc:
        logger.exception("Model download failed")
        raise HTTPException(
            status_code=503,
            detail=(
                f"Model download failed from {HF_MODEL_REPO}. "
                f"Check your internet connection and try again. Error: {exc}"
            ),
        ) from exc

    if not model_file_valid():
        raise HTTPException(
            status_code=503,
            detail=(
                "Downloaded model file is missing or corrupt. "
                f"Expected a valid weights file at backend/model/{HF_MODEL_FILENAME}."
            ),
        )

    logger.info("Model downloaded successfully to %s", MODEL_PATH)


def get_model():
    """Download (if needed), load, and cache the local YOLO segmentation model."""
    global _yolo_model, _inference_device

    ensure_model_downloaded()

    if _yolo_model is None:
        try:
            from ultralytics import YOLO

            _inference_device = get_inference_device()
            logger.info("Loading model from %s on device %s", MODEL_PATH, _inference_device)
            _yolo_model = YOLO(str(MODEL_PATH))
            logger.info("YOLO segmentation model ready (Ultralytics)")
        except Exception as exc:
            logger.exception("Failed to load YOLO model")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to load model file at backend/model/best.pt: {exc}",
            ) from exc

    return _yolo_model


def is_model_loaded() -> bool:
    """True when weights are on disk or cached in memory."""
    return _yolo_model is not None or model_file_valid()


@app.on_event("startup")
def on_startup() -> None:
    """Attempt to fetch model weights when the server starts."""
    logger.info("Starting Car Damage AI backend")
    init_db()
    try:
        ensure_model_downloaded()
    except HTTPException as exc:
        logger.error("Startup model download failed: %s", exc.detail)
    except Exception:
        logger.exception("Unexpected error during startup model check")


def validate_image_file(file: UploadFile) -> None:
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    content_type = (file.content_type or "").lower()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid image type '{content_type}'. "
                "Allowed: JPEG, PNG, WebP, BMP."
            ),
        )


def save_upload(file: UploadFile, raw_bytes: bytes) -> Path:
    suffix = Path(file.filename or "image.jpg").suffix.lower() or ".jpg"
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}:
        suffix = ".jpg"

    unique_name = f"{uuid.uuid4().hex}{suffix}"
    upload_path = UPLOADS_DIR / unique_name
    upload_path.write_bytes(raw_bytes)
    return upload_path


def verify_image_readable(image_path: Path) -> np.ndarray:
    image_bgr = cv2.imread(str(image_path))
    if image_bgr is None:
        try:
            with Image.open(image_path) as pil_img:
                pil_img.verify()
            pil_img = Image.open(image_path).convert("RGB")
            image_bgr = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail="Invalid or corrupt image file.",
            ) from exc

    if image_bgr is None or image_bgr.size == 0:
        raise HTTPException(status_code=400, detail="Invalid or corrupt image file.")

    return image_bgr


def run_inference(model, image_path: Path) -> Any:
    """Run YOLO segmentation inference on GPU or CPU."""
    device = _inference_device if _inference_device != "cpu" else get_inference_device()
    logger.info("Inference started for %s on device %s", image_path.name, device)
    try:
        results = model.predict(
            source=str(image_path),
            device=device,
            verbose=False,
        )
        result = results[0] if results else None
        logger.info("Inference completed for %s", image_path.name)
        return result
    except Exception as exc:
        # Retry on CPU if GPU runs out of memory
        if device != "cpu" and "out of memory" in str(exc).lower():
            logger.warning("GPU OOM — retrying inference on CPU")
            try:
                import torch
                torch.cuda.empty_cache()
                results = model.predict(source=str(image_path), device="cpu", verbose=False)
                return results[0] if results else None
            except Exception as cpu_exc:
                exc = cpu_exc
        logger.exception("Inference failed for %s", image_path)
        raise HTTPException(
            status_code=500,
            detail=f"Inference error: {exc}",
        ) from exc


def build_detections(result) -> list[dict]:
    """
    Build detection list with damage_type, confidence, bbox, and has_mask.
    Supports YOLO segmentation outputs (masks + boxes).
    """
    detections: list[dict] = []

    if result is None or result.boxes is None or len(result.boxes) == 0:
        return detections

    names = result.names or {}
    boxes = result.boxes
    has_masks = result.masks is not None and len(result.masks) > 0

    for i in range(len(boxes)):
        xyxy = boxes.xyxy[i].cpu().numpy().tolist()
        conf = float(boxes.conf[i].cpu().numpy())
        cls_id = int(boxes.cls[i].cpu().numpy())
        damage_type = names.get(cls_id, f"class_{cls_id}")

        has_mask = False
        if has_masks and i < len(result.masks.data):
            mask = result.masks.data[i].cpu().numpy()
            has_mask = bool(mask.size > 0 and mask.sum() > 0)

        detections.append(
            {
                "damage_type": str(damage_type),
                "confidence": round(conf, 4),
                "bbox": [int(round(v)) for v in xyxy],
                "has_mask": has_mask,
            }
        )

    return detections


def enrich_detections_list(
    detections: list[dict],
    *,
    view: str | None = None,
    image_width: int = 0,
    image_height: int = 0,
    image_path: Path | None = None,
    damage_yolo_result=None,
) -> list[dict]:
    """Attach severity, verification, and part localization without changing YOLO."""
    view_label = view or "unknown"
    severity_enriched = [enrich_detection(det, view=view_label) for det in detections]

    if is_vehicle_part_model_enabled() and image_path is not None:
        part_detections = run_part_inference(image_path)
        damage_masks = extract_damage_masks_from_yolo(damage_yolo_result, len(severity_enriched))
        for det, mask in zip(severity_enriched, damage_masks):
            if mask is not None:
                det["_damage_mask"] = mask
        return enrich_detections_with_part_model(
            severity_enriched,
            part_detections,
            image_width,
            image_height,
            view_label,
        )

    return enrich_detections_with_parts(
        severity_enriched,
        image_width,
        image_height,
        view_label,
    )


def draw_annotations(result) -> np.ndarray | None:
    """
    Render segmentation masks and bounding boxes using Ultralytics plot().
    Returns BGR image or None if no result.
    """
    if result is None:
        return None

    try:
        # plot() overlays instance masks, boxes, and class labels
        annotated = result.plot()
        return annotated
    except Exception as exc:
        logger.exception("Failed to render annotations")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to draw annotations: {exc}",
        ) from exc


def save_annotated_image(annotated_bgr: np.ndarray, stem: str) -> str:
    output_filename = f"{stem}_annotated.jpg"
    output_path = OUTPUTS_DIR / output_filename
    cv2.imwrite(str(output_path), annotated_bgr)
    return output_filename


@app.get("/")
async def root():
    return {
        "service": "AutoInspect AI",
        "status": "running",
        "model_source": MODEL_SOURCE,
        "model_loaded": is_model_loaded(),
        "model_path": str(MODEL_PATH),
        "huggingface_repo": HF_MODEL_REPO,
        "endpoints": {
            "predict": "POST /predict — single image inspection",
            "predict_multiview": "POST /predict-multiview — multi-view vehicle inspection",
            "fleet_dashboard": "GET /fleet/dashboard",
            "fleet_inspections": "GET /fleet/inspections",
            "fleet_inspection_pdf": "GET /fleet/inspections/{id}/pdf",
            "ai_inspection_summary": "POST /ai-inspection-summary",
            "ai_inspector_status": "GET /ai-inspector/status",
            "part_model_status": "GET /part-model/status",
            "health": "GET /health",
        },
    }


@app.get("/part-model/status")
async def part_model_status():
    return get_part_model_status()


@app.get("/health")
async def health():
    device_info = get_device_info()
    return {
        "status": "ok",
        "model_loaded": is_model_loaded(),
        "model_source": MODEL_SOURCE,
        **device_info,
    }


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    vehicle_id: str = Form(""),
    view: str = Form("unknown"),
    ai_inspector: str = Form("false"),
):
    """
    Accept a car image, run local YOLOv11 segmentation, return detections + annotated image.
    """
    validate_image_file(file)

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    upload_path = save_upload(file, raw_bytes)
    image_bgr = verify_image_readable(upload_path)

    model = get_model()
    result = run_inference(model, upload_path)
    try:
        normalized_view = normalize_view_label(view) if view else "unknown"
    except ValueError:
        normalized_view = "unknown"
    image_height, image_width = image_bgr.shape[:2]
    detections = enrich_detections_list(
        build_detections(result),
        view=normalized_view,
        image_width=image_width,
        image_height=image_height,
        image_path=upload_path,
        damage_yolo_result=result,
    )

    plotted = draw_annotations(result)
    annotated_bgr = plotted if plotted is not None else image_bgr.copy()

    stem = upload_path.stem
    output_filename = save_annotated_image(annotated_bgr, stem)
    annotated_image_url = f"{API_BASE_URL}/outputs/{output_filename}"

    response_body = {
        "success": True,
        "model_source": MODEL_SOURCE,
        "detections": detections,
        "annotated_image_url": annotated_image_url,
        "upload_filename": upload_path.name,
        "output_filename": output_filename,
    }

    try:
        saved_id = persist_single_inspection(
            vehicle_id=vehicle_id,
            view=view,
            detections=detections,
            response_body=response_body,
        )
        response_body["inspection_id"] = saved_id
    except Exception:
        logger.exception("Failed to persist single inspection record")

    await _attach_ai_inspection(
        response_body,
        build_context_from_single(
            vehicle_id=vehicle_id,
            inspection_id=response_body.get("inspection_id"),
            view=view,
            detections=detections,
        ),
        ai_inspector,
    )

    logger.info(
        "Prediction complete — %d detection(s), output=%s",
        len(detections),
        output_filename,
    )

    return JSONResponse(content=response_body)


async def _process_single_view_image(
    file: UploadFile,
    view_label: str,
    model,
) -> dict:
    """Run inference for one view image and return structured view result."""
    validate_image_file(file)

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"Uploaded file for view '{view_label}' is empty.",
        )

    upload_path = save_upload(file, raw_bytes)
    image_bgr = verify_image_readable(upload_path)

    try:
        result = run_inference(model, upload_path)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Inference failed for view %s", view_label)
        raise HTTPException(
            status_code=500,
            detail=f"Inference failed for view '{view_label}': {exc}",
        ) from exc

    image_height, image_width = image_bgr.shape[:2]
    detections = enrich_detections_list(
        build_detections(result),
        view=view_label,
        image_width=image_width,
        image_height=image_height,
        image_path=upload_path,
        damage_yolo_result=result,
    )

    plotted = draw_annotations(result)
    annotated_bgr = plotted if plotted is not None else image_bgr.copy()

    output_stem = f"{view_label}_{upload_path.stem}"
    output_filename = save_annotated_image(annotated_bgr, output_stem)
    annotated_image_url = f"{API_BASE_URL}/outputs/{output_filename}"

    original_name = file.filename or f"{view_label}.jpg"

    return {
        "view": view_label,
        "filename": original_name,
        "upload_filename": upload_path.name,
        "output_filename": output_filename,
        "annotated_image_url": annotated_image_url,
        "detections": detections,
        "view_summary": generate_view_summary(view_label, detections),
    }


@app.post("/predict-multiview")
async def predict_multiview(
    files: list[UploadFile] = File(...),
    views: list[str] = Form(...),
    vehicle_id: str = Form(""),
    ai_inspector: str = Form("false"),
    mission_name: str = Form(""),
    robot_mode: str = Form("false"),
    capture_sequence: str = Form(""),
):
    """
    Accept multiple vehicle images with view labels, run YOLO on each,
    and return a combined vehicle-level inspection report.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    if not views:
        raise HTTPException(
            status_code=400,
            detail="No view labels provided. Include one view label per image.",
        )

    if len(files) != len(views):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Mismatch between files ({len(files)}) and view labels ({len(views)}). "
                "Provide exactly one view label for each uploaded image."
            ),
        )

    normalized_views: list[str] = []
    try:
        for view in views:
            normalized_views.append(normalize_view_label(view))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    inspection_id = str(uuid.uuid4())
    model = get_model()

    view_results: list[dict] = []
    for file, view_label in zip(files, normalized_views):
        try:
            view_result = await _process_single_view_image(file, view_label, model)
            view_results.append(view_result)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Unexpected error processing view %s", view_label)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to process view '{view_label}': {exc}",
            ) from exc

    combined_report = generate_combined_report(view_results)
    vehicle_level_summary = build_vehicle_level_summary(view_results, combined_report)

    robot_metadata: dict[str, Any] | None = None
    if _robot_mode_requested(robot_mode) or mission_name.strip():
        sequence = _parse_capture_sequence(capture_sequence) or normalized_views
        robot_metadata = {
            "mission_name": mission_name.strip() or None,
            "robot_mode": _robot_mode_requested(robot_mode),
            "capture_sequence": sequence,
        }

    response_body = {
        "success": True,
        "inspection_id": inspection_id,
        "model_source": MODEL_SOURCE,
        "vehicle_level_summary": vehicle_level_summary,
        "views": [
            {
                "view": vr["view"],
                "filename": vr["filename"],
                "annotated_image_url": vr["annotated_image_url"],
                "detections": vr["detections"],
                "view_summary": vr["view_summary"],
            }
            for vr in view_results
        ],
        "combined_report": combined_report,
    }
    if robot_metadata:
        response_body["robot_mission"] = robot_metadata

    try:
        persist_multiview_inspection(
            inspection_id=inspection_id,
            vehicle_id=vehicle_id,
            view_results=view_results,
            combined_report=combined_report,
            response_body=response_body,
            robot_metadata=robot_metadata,
        )
    except Exception:
        logger.exception("Failed to persist multiview inspection record")

    await _attach_ai_inspection(
        response_body,
        build_context_from_multiview(
            vehicle_id=vehicle_id,
            inspection_id=inspection_id,
            view_results=view_results,
            combined_report=combined_report,
            vehicle_level_summary=vehicle_level_summary,
        ),
        ai_inspector,
    )

    logger.info(
        "Multi-view inspection %s complete — %d image(s), %d total detection(s)",
        inspection_id,
        len(view_results),
        vehicle_level_summary["total_damages"],
    )

    return JSONResponse(content=response_body)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
