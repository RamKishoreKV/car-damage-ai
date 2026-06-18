"""
Download labeled vehicle damage test images from the public CarDD dataset (Hugging Face).

Places at least N images per class into backend/test_images/<class>/.

Usage:
    cd backend
    venv\\Scripts\\activate
    pip install -r requirements-eval.txt
    python download_test_dataset.py
    python download_test_dataset.py --per-class 15
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import defaultdict
from pathlib import Path

import requests

from eval_labels import MODEL_LABEL_TO_FOLDER, TEST_CLASSES

BASE_DIR = Path(__file__).resolve().parent
TEST_IMAGES_DIR = BASE_DIR / "test_images"

CARDD_SAMPLES_URL = (
    "https://huggingface.co/datasets/harpreetsahota/CarDD/resolve/main/samples.json"
)
CARDD_IMAGE_BASE = (
    "https://huggingface.co/datasets/harpreetsahota/CarDD/resolve/main/"
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)


def ensure_class_folders() -> None:
    for class_name in TEST_CLASSES:
        (TEST_IMAGES_DIR / class_name).mkdir(parents=True, exist_ok=True)


def load_cardd_samples() -> list[dict]:
    logger.info("Fetching CarDD sample metadata from Hugging Face...")
    response = requests.get(CARDD_SAMPLES_URL, timeout=120)
    response.raise_for_status()
    payload = response.json()
    samples = payload.get("samples", payload)
    if not isinstance(samples, list):
        raise ValueError("Unexpected CarDD samples.json format")
    logger.info("Loaded metadata for %d CarDD samples", len(samples))
    return samples


def sample_labels(sample: dict) -> list[str]:
    detections = sample.get("detections", {}).get("detections", [])
    return [str(d.get("label", "")).strip().lower() for d in detections if d.get("label")]


def pick_samples_per_class(
    samples: list[dict],
    per_class: int,
) -> dict[str, list[dict]]:
    """Select up to per_class images for each damage category."""
    buckets: dict[str, list[dict]] = defaultdict(list)
    seen_paths: set[str] = set()

    # Prefer images whose first detection label maps cleanly to one folder
    for sample in samples:
        filepath = sample.get("filepath", "")
        if not filepath or filepath in seen_paths:
            continue

        labels = sample_labels(sample)
        if not labels:
            continue

        primary = labels[0]
        folder = MODEL_LABEL_TO_FOLDER.get(primary)
        if not folder or folder not in TEST_CLASSES:
            continue

        if len(buckets[folder]) >= per_class:
            continue

        buckets[folder].append(sample)
        seen_paths.add(filepath)

    # Second pass: fill gaps using any matching label in detections
    for sample in samples:
        filepath = sample.get("filepath", "")
        if not filepath or filepath in seen_paths:
            continue

        labels = sample_labels(sample)
        for label in labels:
            folder = MODEL_LABEL_TO_FOLDER.get(label)
            if not folder or folder not in TEST_CLASSES:
                continue
            if len(buckets[folder]) >= per_class:
                continue
            buckets[folder].append(sample)
            seen_paths.add(filepath)
            break

    return buckets


def download_image(filepath: str, dest: Path) -> bool:
    url = f"{CARDD_IMAGE_BASE}{filepath.replace(chr(92), '/')}"
    try:
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        dest.write_bytes(response.content)
        return True
    except Exception as exc:
        logger.warning("Failed to download %s: %s", url, exc)
        return False


def download_dataset(per_class: int, overwrite: bool) -> None:
    ensure_class_folders()
    samples = load_cardd_samples()
    selected = pick_samples_per_class(samples, per_class)

    total_downloaded = 0
    print()
    print("=" * 50)
    print("DOWNLOADING CarDD TEST IMAGES")
    print("=" * 50)

    for class_name in TEST_CLASSES:
        class_dir = TEST_IMAGES_DIR / class_name
        existing = list(class_dir.glob("*.*"))
        if existing and not overwrite and len(existing) >= per_class:
            logger.info("Skipping %s — already has %d images", class_name, len(existing))
            print(f"  {class_name}: skipped ({len(existing)} already present)")
            continue

        if overwrite:
            for old in class_dir.iterdir():
                if old.is_file() and old.name != ".gitkeep":
                    old.unlink()

        class_samples = selected.get(class_name, [])
        downloaded = 0

        for sample in class_samples:
            filepath = sample["filepath"]
            filename = Path(filepath).name
            dest = class_dir / filename
            if dest.exists() and not overwrite:
                downloaded += 1
                continue
            if download_image(filepath, dest):
                downloaded += 1
                logger.info("Saved %s -> %s", filename, class_name)

        total_downloaded += downloaded
        status = "OK" if downloaded >= per_class else "LOW"
        print(f"  {class_name}: {downloaded} images [{status}]")

    print("=" * 50)
    print(f"Total downloaded this run: {total_downloaded}")
    print(f"Test images folder: {TEST_IMAGES_DIR}")
    print("=" * 50)

    short_classes = [
        c for c in TEST_CLASSES
        if len([p for p in (TEST_IMAGES_DIR / c).iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}]) < per_class
    ]
    if short_classes:
        logger.warning(
            "Some classes have fewer than %d images: %s. Re-run or increase CarDD coverage.",
            per_class,
            ", ".join(short_classes),
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download CarDD test images by damage class.")
    parser.add_argument(
        "--per-class",
        type=int,
        default=10,
        help="Target number of images per class (default: 10)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing images in test_images/",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        download_dataset(per_class=args.per_class, overwrite=args.overwrite)
    except Exception as exc:
        logger.exception("Dataset download failed")
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
