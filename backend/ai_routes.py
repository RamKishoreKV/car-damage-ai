"""
AI Inspection Assistant API routes (Phase 4).
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ai_inspector import (
    generate_ai_inspection_summary,
    is_ai_inspector_enabled,
    validate_inspection_context,
)

router = APIRouter(tags=["ai-inspector"])


class DetectionContext(BaseModel):
    view: str = "unknown"
    damage_type: str
    confidence: float = 0.0
    severity: str = "Low"
    bbox: list[int] | None = None


class InspectionContextRequest(BaseModel):
    vehicle_id: str = "UNASSIGNED"
    inspection_id: str = ""
    mode: Literal["single", "multiview"] = "single"
    views_inspected: list[str] = Field(default_factory=list)
    detections: list[DetectionContext] = Field(default_factory=list)
    overall_severity: str = "None"
    fleet_status: str = ""


@router.get("/ai-inspector/status")
async def ai_inspector_status():
    """Return whether AI inspector mode is enabled on the server."""
    return {"enabled": is_ai_inspector_enabled()}


@router.post("/ai-inspection-summary")
async def ai_inspection_summary(body: InspectionContextRequest):
    """
    Accept grounded YOLO inspection context and return a natural-language summary.
    Falls back to rule-based output when Ollama is unavailable.
    """
    try:
        context = validate_inspection_context(body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return generate_ai_inspection_summary(context)
