"""Capture portfolio screenshots for docs/screenshots/ via Playwright."""

from __future__ import annotations

import sys
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCREENSHOTS = ROOT / "docs" / "screenshots"
TEST_IMAGES = ROOT / "backend" / "test_images"
FRONTEND_URL = "http://localhost:5173"
VEHICLE_ID = "DEMO-FLEET-01"
VIEWPORT = {"width": 1920, "height": 1080}


def pick_image(category: str) -> Path:
    folder = TEST_IMAGES / category
    for path in sorted(folder.glob("*.jpg")):
        return path
    raise FileNotFoundError(f"No .jpg images in {folder}")


def wait_for_inference(page, timeout_ms: int = 120_000) -> None:
    page.get_by_role("heading", name="Detection Results").wait_for(
        state="visible", timeout=timeout_ms
    )


def wait_for_multiview(page, timeout_ms: int = 180_000) -> None:
    page.get_by_text("Vehicle-Level Summary", exact=False).wait_for(
        state="visible", timeout=timeout_ms
    )


def nav_tab(page, name: str) -> None:
    page.locator("button.nav-tab", has_text=name).click()


def run_single_inspection(page, image: Path, *, ai_mode: bool = False) -> None:
    nav_tab(page, "Inspection")
    page.get_by_role("button", name="Single Image Inspection", exact=True).click()

    ai_checkbox = page.locator('input[type="checkbox"]').first
    if ai_mode != ai_checkbox.is_checked():
        ai_checkbox.click()

    page.locator("#vehicle-id").fill(VEHICLE_ID)
    page.locator('input[type="file"]').first.set_input_files(str(image))
    page.get_by_role("button", name="Detect Damage").click()
    wait_for_inference(page)

    if ai_mode:
        page.get_by_role("heading", name="AI Inspection Assistant").wait_for(
            state="visible", timeout=30_000
        )


def run_multiview_inspection(page, images: list[Path]) -> None:
    nav_tab(page, "Inspection")
    page.get_by_role("button", name="Multi-View Inspection", exact=True).click()
    page.locator("#multiview-vehicle-id").fill(VEHICLE_ID)

    file_inputs = page.locator('input[type="file"]')
    count = min(file_inputs.count(), len(images))
    for index in range(count):
        file_inputs.nth(index).set_input_files(str(images[index]))

    page.get_by_role("button", name="Run Multi-View Inspection").click()
    wait_for_multiview(page)


def run_robot_mission(page, images: list[Path]) -> None:
    nav_tab(page, "Robot Simulator")
    page.locator('input[placeholder="e.g. EV-1042"]').first.fill(VEHICLE_ID)

    file_inputs = page.locator('input[type="file"]')
    count = min(file_inputs.count(), len(images))
    for index in range(count):
        file_inputs.nth(index).set_input_files(str(images[index]))

    page.get_by_role("button", name="Start Robot Inspection Mission").click()
    page.get_by_text("COMPLETE", exact=False).wait_for(state="visible", timeout=180_000)
    page.get_by_text("Mission complete", exact=False).wait_for(
        state="visible", timeout=10_000
    )


def capture(name: str, page) -> Path:
    path = SCREENSHOTS / name
    page.screenshot(path=str(path), full_page=True)
    print(f"Saved {path}")
    return path


def main() -> int:
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)

    sample_images = [
        pick_image("broken_lamp"),
        pick_image("dent"),
        pick_image("scratch"),
        pick_image("crack"),
    ]
    single_image = pick_image("broken_lamp")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport=VIEWPORT, device_scale_factor=1)
        page = context.new_page()

        try:
            page.goto(FRONTEND_URL, wait_until="networkidle", timeout=60_000)
            nav_tab(page, "Inspection")
            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.5)
            capture("01_home_hero.png", page)

            run_single_inspection(page, single_image, ai_mode=False)
            capture("02_single_inspection.png", page)

            run_multiview_inspection(page, sample_images)
            capture("03_multiview_inspection.png", page)

            run_single_inspection(page, single_image, ai_mode=True)
            capture("04_ai_inspector.png", page)

            nav_tab(page, "Fleet Dashboard")
            page.get_by_role("heading", name="Fleet Dashboard").wait_for(
                state="visible", timeout=30_000
            )
            page.get_by_text("Total Inspections", exact=False).wait_for(
                state="visible", timeout=30_000
            )
            time.sleep(0.5)
            capture("05_fleet_dashboard.png", page)

            nav_tab(page, "History")
            page.get_by_role("heading", name="Inspection History").wait_for(
                state="visible", timeout=30_000
            )
            page.get_by_role("button", name="Details").first.click()
            page.get_by_role("link", name="Download PDF Report").wait_for(
                state="visible", timeout=30_000
            )
            time.sleep(0.5)
            capture("06_history_pdf.png", page)

            run_robot_mission(page, sample_images)
            capture("07_robot_simulator.png", page)

        except PlaywrightTimeout as exc:
            print(f"Screenshot capture timed out: {exc}", file=sys.stderr)
            return 1
        finally:
            context.close()
            browser.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
