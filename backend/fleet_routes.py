"""
Fleet dashboard API routes (Phase 3).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from database import get_dashboard_stats, get_inspection, list_inspections
from pdf_report import generate_inspection_pdf

router = APIRouter(prefix="/fleet", tags=["fleet"])


@router.get("/dashboard")
async def fleet_dashboard(
    recent_limit: int = Query(default=10, ge=1, le=50),
):
    """Fleet dashboard stats: totals, high severity count, recent inspections."""
    return get_dashboard_stats(recent_limit=recent_limit)


@router.get("/inspections")
async def fleet_inspections(
    vehicle_id: str | None = Query(default=None, description="Search by vehicle ID"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Inspection history with optional vehicle ID search."""
    return list_inspections(vehicle_id=vehicle_id, limit=limit, offset=offset)


@router.get("/inspections/{inspection_id}")
async def fleet_inspection_detail(inspection_id: str):
    """Full inspection record by ID."""
    record = get_inspection(inspection_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Inspection not found.")
    return record


@router.get("/inspections/{inspection_id}/pdf")
async def fleet_inspection_pdf(inspection_id: str):
    """Download inspection report as PDF."""
    record = get_inspection(inspection_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Inspection not found.")

    pdf_bytes = generate_inspection_pdf(record)
    filename = f"inspection_{inspection_id[:8]}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
