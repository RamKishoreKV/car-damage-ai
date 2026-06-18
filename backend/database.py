"""
SQLite persistence for fleet inspection records (Phase 3).
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "fleet.db"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Create inspections table if it does not exist."""
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inspections (
                inspection_id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                vehicle_id TEXT NOT NULL,
                severity TEXT NOT NULL,
                damages TEXT NOT NULL,
                views_inspected TEXT NOT NULL,
                inspection_type TEXT NOT NULL DEFAULT 'multiview',
                report_json TEXT
            )
            """
        )
        _migrate_db(conn)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_inspections_vehicle_id ON inspections(vehicle_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_inspections_timestamp ON inspections(timestamp DESC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_inspections_severity ON inspections(severity)"
        )


def _migrate_db(conn: sqlite3.Connection) -> None:
    """Apply additive schema migrations without breaking existing databases."""
    columns = {
        row[1] for row in conn.execute("PRAGMA table_info(inspections)").fetchall()
    }
    if "metadata_json" not in columns:
        conn.execute("ALTER TABLE inspections ADD COLUMN metadata_json TEXT")


def save_inspection(
    *,
    inspection_id: str,
    vehicle_id: str,
    severity: str,
    damages: list[dict[str, Any]],
    views_inspected: list[str],
    inspection_type: str,
    report_json: dict[str, Any] | None = None,
    metadata_json: dict[str, Any] | None = None,
    timestamp: str | None = None,
) -> dict[str, Any]:
    """Insert a new inspection record."""
    ts = timestamp or _utc_now_iso()
    record = {
        "inspection_id": inspection_id,
        "timestamp": ts,
        "vehicle_id": vehicle_id.strip() or "UNASSIGNED",
        "severity": severity,
        "damages": damages,
        "views_inspected": views_inspected,
        "inspection_type": inspection_type,
        "report_json": report_json,
        "metadata_json": metadata_json,
    }

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO inspections (
                inspection_id, timestamp, vehicle_id, severity,
                damages, views_inspected, inspection_type, report_json,
                metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["inspection_id"],
                record["timestamp"],
                record["vehicle_id"],
                record["severity"],
                json.dumps(damages),
                json.dumps(views_inspected),
                inspection_type,
                json.dumps(report_json) if report_json is not None else None,
                json.dumps(metadata_json) if metadata_json is not None else None,
            ),
        )

    return record


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    metadata = None
    if "metadata_json" in row.keys() and row["metadata_json"]:
        metadata = json.loads(row["metadata_json"])

    return {
        "inspection_id": row["inspection_id"],
        "timestamp": row["timestamp"],
        "vehicle_id": row["vehicle_id"],
        "severity": row["severity"],
        "damages": json.loads(row["damages"]),
        "views_inspected": json.loads(row["views_inspected"]),
        "inspection_type": row["inspection_type"],
        "report_json": json.loads(row["report_json"]) if row["report_json"] else None,
        "metadata_json": metadata,
    }


def get_dashboard_stats(*, recent_limit: int = 10) -> dict[str, Any]:
    """Return fleet dashboard aggregates."""
    with get_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM inspections").fetchone()[0]
        high_severity = conn.execute(
            "SELECT COUNT(*) FROM inspections WHERE severity = 'High'"
        ).fetchone()[0]
        rows = conn.execute(
            """
            SELECT inspection_id, timestamp, vehicle_id, severity,
                   damages, views_inspected, inspection_type
            FROM inspections
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            (recent_limit,),
        ).fetchall()

    recent = []
    for row in rows:
        recent.append({
            "inspection_id": row["inspection_id"],
            "timestamp": row["timestamp"],
            "vehicle_id": row["vehicle_id"],
            "severity": row["severity"],
            "damage_count": len(json.loads(row["damages"])),
            "views_inspected": json.loads(row["views_inspected"]),
            "inspection_type": row["inspection_type"],
        })

    return {
        "total_inspections": total,
        "high_severity_count": high_severity,
        "recent_inspections": recent,
    }


def list_inspections(
    *,
    vehicle_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """List inspections with optional vehicle_id filter."""
    query = """
        SELECT inspection_id, timestamp, vehicle_id, severity,
               damages, views_inspected, inspection_type
        FROM inspections
    """
    params: list[Any] = []

    if vehicle_id and vehicle_id.strip():
        query += " WHERE vehicle_id LIKE ?"
        params.append(f"%{vehicle_id.strip()}%")

    query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
        count_query = "SELECT COUNT(*) FROM inspections"
        count_params: list[Any] = []
        if vehicle_id and vehicle_id.strip():
            count_query += " WHERE vehicle_id LIKE ?"
            count_params.append(f"%{vehicle_id.strip()}%")
        total = conn.execute(count_query, count_params).fetchone()[0]

    items = []
    for row in rows:
        items.append({
            "inspection_id": row["inspection_id"],
            "timestamp": row["timestamp"],
            "vehicle_id": row["vehicle_id"],
            "severity": row["severity"],
            "damage_count": len(json.loads(row["damages"])),
            "views_inspected": json.loads(row["views_inspected"]),
            "inspection_type": row["inspection_type"],
        })

    return {"total": total, "items": items, "limit": limit, "offset": offset}


def get_inspection(inspection_id: str) -> dict[str, Any] | None:
    """Fetch a single inspection by ID."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM inspections WHERE inspection_id = ?",
            (inspection_id,),
        ).fetchone()

    if row is None:
        return None
    return _row_to_dict(row)
