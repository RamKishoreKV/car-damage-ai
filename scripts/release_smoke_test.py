"""Smoke tests for GitHub release checklist (API + build helpers)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import httpx
import requests

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
TEST_IMAGES = BACKEND / "test_images"
API = "http://localhost:8000"


def pick_image(category: str) -> Path:
    folder = TEST_IMAGES / category
    for path in sorted(folder.glob("*.jpg")):
        return path
    raise FileNotFoundError(f"No images in {folder}")


def check_health(client: httpx.Client) -> None:
    response = client.get(f"{API}/health")
    response.raise_for_status()
    payload = response.json()
    assert payload.get("status") == "ok", payload
    assert payload.get("model_loaded") is True, payload
    print("health: ok")


def check_single_predict(client: httpx.Client) -> str | None:
    image = pick_image("broken_lamp")
    with image.open("rb") as handle:
        response = client.post(
            f"{API}/predict",
            files={"file": (image.name, handle, "image/jpeg")},
            data={"vehicle_id": "SMOKE-TEST", "vehicle_view": "front"},
            timeout=120.0,
        )
    response.raise_for_status()
    payload = response.json()
    assert "detections" in payload, payload
    inspection_id = payload.get("inspection_id")
    print(f"single predict: ok ({len(payload['detections'])} detections)")
    return inspection_id


def check_multiview_predict(client: httpx.Client) -> str | None:
    images = [pick_image(cat) for cat in ("dent", "scratch", "crack", "broken_lamp")]
    views = ("front", "rear", "left_side", "right_side")
    file_handles = []
    files = []
    for path in images:
        handle = path.open("rb")
        file_handles.append(handle)
        files.append(("files", (path.name, handle, "image/jpeg")))
    data = [("vehicle_id", "SMOKE-MULTI"), *[("views", view) for view in views]]
    try:
        response = requests.post(
            f"{API}/predict-multiview",
            files=files,
            data=data,
            timeout=180,
        )
    finally:
        for handle in file_handles:
            handle.close()
    response.raise_for_status()
    response.raise_for_status()
    payload = response.json()
    assert payload.get("combined_report") is not None, payload
    inspection_id = payload.get("inspection_id")
    print("multiview predict: ok")
    return inspection_id


def check_pdf_export(client: httpx.Client, inspection_id: str | None) -> None:
    if not inspection_id:
        listing = client.get(f"{API}/fleet/inspections?limit=1")
        listing.raise_for_status()
        items = listing.json().get("items") or []
        if not items:
            raise RuntimeError("No inspections available for PDF export test")
        inspection_id = items[0]["inspection_id"]

    response = client.get(f"{API}/fleet/inspections/{inspection_id}/pdf")
    response.raise_for_status()
    assert response.headers.get("content-type", "").startswith("application/pdf")
    assert len(response.content) > 500
    print(f"pdf export: ok ({inspection_id})")


def check_dashboard(client: httpx.Client) -> None:
    response = client.get(f"{API}/fleet/dashboard")
    response.raise_for_status()
    payload = response.json()
    assert "total_inspections" in payload, payload
    print(f"fleet dashboard: ok ({payload['total_inspections']} inspections)")


def check_frontend_build() -> None:
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=ROOT / "frontend",
        capture_output=True,
        text=True,
        shell=True,
        check=False,
    )
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise RuntimeError("frontend build failed")
    print("frontend build: ok")


def main() -> int:
    try:
        with httpx.Client(timeout=30.0) as client:
            check_health(client)
            single_id = check_single_predict(client)
            multi_id = check_multiview_predict(client)
            check_pdf_export(client, multi_id or single_id)
            check_dashboard(client)
        check_frontend_build()
    except Exception as exc:
        print(f"smoke test failed: {exc}", file=sys.stderr)
        return 1
    print("All smoke tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
