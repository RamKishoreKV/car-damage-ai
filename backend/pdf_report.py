"""
PDF export for fleet inspection reports.
"""

from __future__ import annotations

import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title",
            parent=base["Heading1"],
            fontSize=18,
            spaceAfter=12,
            textColor=colors.HexColor("#1e3a5f"),
        ),
        "heading": ParagraphStyle(
            "SectionHeading",
            parent=base["Heading2"],
            fontSize=13,
            spaceBefore=14,
            spaceAfter=8,
            textColor=colors.HexColor("#2563eb"),
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontSize=10,
            leading=14,
        ),
        "mono": ParagraphStyle(
            "Mono",
            parent=base["Code"],
            fontSize=9,
            leading=12,
        ),
    }


def _capitalize(text: str) -> str:
    return (text or "").replace("_", " ").title()


def generate_inspection_pdf(inspection: dict[str, Any]) -> bytes:
    """Render an inspection record as a PDF byte stream."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )
    styles = _styles()
    story: list[Any] = []

    story.append(Paragraph("AutoInspect AI — Vehicle Inspection Report", styles["title"]))
    story.append(Spacer(1, 6))

    meta_rows = [
        ["Inspection ID", inspection.get("inspection_id", "—")],
        ["Vehicle ID", inspection.get("vehicle_id", "—")],
        ["Timestamp (UTC)", inspection.get("timestamp", "—")],
        ["Overall Severity", inspection.get("severity", "—")],
        ["Inspection Type", inspection.get("inspection_type", "—")],
        [
            "Views Inspected",
            ", ".join(_capitalize(v) for v in inspection.get("views_inspected") or []) or "—",
        ],
    ]
    meta_table = Table(meta_rows, colWidths=[1.6 * inch, 4.8 * inch])
    meta_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eff6ff")),
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#1e293b")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ])
    )
    story.append(meta_table)

    report = inspection.get("report_json") or {}
    robot_mission = (
        inspection.get("metadata_json")
        or report.get("robot_mission")
        or {}
    )
    if robot_mission:
        story.append(Spacer(1, 12))
        story.append(Paragraph("Robot Mission", styles["heading"]))
        mission_rows = [
            ["Mission Name", robot_mission.get("mission_name") or "—"],
            [
                "Robot Mode",
                "Yes" if robot_mission.get("robot_mode") else "No",
            ],
            [
                "Capture Sequence",
                ", ".join(
                    _capitalize(v)
                    for v in (robot_mission.get("capture_sequence") or [])
                )
                or "—",
            ],
            ["Mission Completed (UTC)", robot_mission.get("mission_completed_at") or "—"],
        ]
        mission_table = Table(mission_rows, colWidths=[1.6 * inch, 4.8 * inch])
        mission_table.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0fdf4")),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#1e293b")),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ])
        )
        story.append(mission_table)

    summary = report.get("combined_report", {}).get("summary") or report.get("vehicle_level_summary")
    if isinstance(summary, dict):
        summary_text = (
            f"{summary.get('total_damages', 0)} damage(s) across "
            f"{len(summary.get('views_inspected') or [])} view(s). "
            f"Fleet status: {summary.get('fleet_status', '—')}."
        )
    elif isinstance(summary, str):
        summary_text = summary
    else:
        combined = report.get("combined_report", {})
        summary_text = combined.get("summary", "No summary available.")

    story.append(Spacer(1, 12))
    story.append(Paragraph("Summary", styles["heading"]))
    story.append(Paragraph(summary_text, styles["body"]))

    damages = inspection.get("damages") or []
    story.append(Paragraph(f"Damage Findings ({len(damages)})", styles["heading"]))

    if not damages:
        story.append(Paragraph("No Model-Detected Damage.", styles["body"]))
    else:
        damage_rows = [["View", "Vehicle Part", "Damage Type", "Severity", "Localization", "Confidence"]]
        for item in damages:
            conf = item.get("confidence")
            conf_str = f"{float(conf) * 100:.1f}%" if conf is not None else "—"
            method = item.get("localization_method", "rule_based_bbox")
            method_label = (
                "Part Model"
                if method == "part_model_overlap"
                else "Rule-Based"
            )
            damage_rows.append([
                _capitalize(item.get("view", "—")),
                _capitalize(item.get("vehicle_part", "—")),
                _capitalize(item.get("damage_type", "—")),
                item.get("severity", "—"),
                method_label,
                conf_str,
            ])

        damage_table = Table(
            damage_rows,
            colWidths=[0.8 * inch, 1.2 * inch, 1.0 * inch, 0.7 * inch, 0.9 * inch, 0.7 * inch],
            repeatRows=1,
        )
        damage_table.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2563eb")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ])
        )
        story.append(damage_table)

    suggested = report.get("combined_report", {}).get("suggested_action")
    if suggested:
        story.append(Paragraph("Recommended Action", styles["heading"]))
        story.append(Paragraph(suggested, styles["body"]))

    story.append(Spacer(1, 16))
    story.append(
        Paragraph(
            "Generated by AutoInspect AI — Fleet Vehicle Inspection Platform",
            styles["mono"],
        )
    )

    doc.build(story)
    return buffer.getvalue()
