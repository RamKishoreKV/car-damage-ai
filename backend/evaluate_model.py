"""
Model validation workflow for car-damage-ai.

Evaluates the YOLOv11 segmentation model on a structured test_images/ dataset
with per-class folders as ground truth labels.

Usage:
    cd backend
    venv\\Scripts\\activate
    pip install -r requirements-eval.txt

    python download_test_dataset.py
    python evaluate_model.py --input test_images
    python evaluate_model.py --input test_images --device 0
    python evaluate_model.py --input test_images --confidence 0.25
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from sklearn.metrics import confusion_matrix

from eval_labels import (
    TEST_CLASSES,
    ground_truth_in_predictions,
    labels_match,
    model_label_to_folder,
    normalize_label,
)

# ---------------------------------------------------------------------------
# Paths — match backend/main.py
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "model" / "best.pt"
EVAL_ROOT = BASE_DIR / "evaluation_outputs"
ANNOTATED_DIR = EVAL_ROOT / "annotated"
REPORTS_DIR = EVAL_ROOT / "reports"
CONFUSION_DIR = EVAL_ROOT / "confusion_matrices"
MIN_MODEL_BYTES = 50_000_000

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
CONFUSION_LABELS = TEST_CLASSES + ["none"]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)


@dataclass
class EvalRow:
    image_name: str
    image_path: str
    ground_truth: str
    predicted_classes: list[str] = field(default_factory=list)
    confidence_scores: list[float] = field(default_factory=list)
    top_prediction: str = ""
    top_confidence: float = 0.0
    correct_prediction: bool = False  # top-1 correct
    correct_top3: bool = False
    ground_truth_detected: bool = False  # detection recall (per image)
    num_detections: int = 0
    annotated_path: str = ""


def ensure_output_dirs() -> None:
    for path in (EVAL_ROOT, ANNOTATED_DIR, REPORTS_DIR, CONFUSION_DIR):
        path.mkdir(parents=True, exist_ok=True)


def model_file_valid() -> bool:
    try:
        return MODEL_PATH.is_file() and MODEL_PATH.stat().st_size >= MIN_MODEL_BYTES
    except OSError:
        return False


def ensure_model_exists() -> None:
    if not model_file_valid():
        logger.error("Model not found at %s", MODEL_PATH)
        sys.exit(1)


def resolve_device(requested: str | None) -> str | int:
    if requested is not None:
        if requested.lower() == "cpu":
            return "cpu"
        if requested.isdigit():
            return int(requested)
        return requested

    try:
        import torch

        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            logger.info("CUDA available — using GPU: %s", name)
            return 0
    except Exception as exc:
        logger.warning("CUDA unavailable, using CPU: %s", exc)

    logger.info("Using CPU for inference")
    return "cpu"


def is_structured_dataset(input_dir: Path) -> bool:
    return any(
        p.is_dir() and p.name in TEST_CLASSES
        for p in input_dir.iterdir()
    )


def collect_labeled_images(input_dir: Path) -> list[tuple[Path, str]]:
    """Collect (image_path, ground_truth_folder) from class subfolders."""
    samples: list[tuple[Path, str]] = []

    if is_structured_dataset(input_dir):
        for class_dir in sorted(input_dir.iterdir()):
            if not class_dir.is_dir() or class_dir.name not in TEST_CLASSES:
                continue
            ground_truth = class_dir.name
            for image_path in sorted(class_dir.iterdir()):
                if image_path.is_file() and image_path.suffix.lower() in IMAGE_EXTENSIONS:
                    samples.append((image_path, ground_truth))
        return samples

    # Flat folder fallback (no ground truth)
    for image_path in sorted(input_dir.iterdir()):
        if image_path.is_file() and image_path.suffix.lower() in IMAGE_EXTENSIONS:
            samples.append((image_path, "unknown"))

    return samples


def extract_detections(result, confidence_threshold: float) -> tuple[list[str], list[float]]:
    classes: list[str] = []
    scores: list[float] = []

    if result is None or result.boxes is None or len(result.boxes) == 0:
        return classes, scores

    names = result.names or {}
    boxes = result.boxes

    for i in range(len(boxes)):
        conf = float(boxes.conf[i].cpu().numpy())
        if conf < confidence_threshold:
            continue
        cls_id = int(boxes.cls[i].cpu().numpy())
        label = str(names.get(cls_id, f"class_{cls_id}"))
        classes.append(label)
        scores.append(round(conf, 4))

    return classes, scores


def pick_top_prediction(classes: list[str], scores: list[float]) -> tuple[str, float]:
    if not classes:
        return "", 0.0
    best_idx = int(np.argmax(scores))
    return classes[best_idx], float(scores[best_idx])


def top_k_classes(classes: list[str], scores: list[float], k: int) -> list[str]:
    """Return up to k class names ordered by descending confidence."""
    if not classes:
        return []
    ranked = sorted(zip(classes, scores), key=lambda pair: pair[1], reverse=True)
    return [cls for cls, _ in ranked[:k]]


def is_top3_correct(ground_truth: str, classes: list[str], scores: list[float]) -> bool:
    """True when ground truth appears among the top-3 confidence predictions."""
    if ground_truth not in TEST_CLASSES:
        return False
    return ground_truth_in_predictions(ground_truth, top_k_classes(classes, scores, 3))


def labeled_rows(rows: list[EvalRow]) -> list[EvalRow]:
    return [r for r in rows if r.ground_truth in TEST_CLASSES]


def run_inference(model, image_path: Path, device: str | int, confidence: float):
    logger.info("Inference started: %s", image_path.name)
    try:
        results = model.predict(
            source=str(image_path),
            device=device,
            conf=confidence,
            verbose=False,
        )
        logger.info("Inference completed: %s", image_path.name)
        return results[0] if results else None
    except Exception as exc:
        if device != "cpu" and "out of memory" in str(exc).lower():
            logger.warning("GPU OOM on %s — retrying on CPU", image_path.name)
            import torch
            torch.cuda.empty_cache()
            results = model.predict(
                source=str(image_path),
                device="cpu",
                conf=confidence,
                verbose=False,
            )
            return results[0] if results else None
        raise


def compute_metrics(rows: list[EvalRow], confidence_threshold: float, device: str | int) -> dict:
    eval_rows = labeled_rows(rows)
    total_images = len(eval_rows)
    images_with_detections = sum(1 for r in eval_rows if r.num_detections > 0)

    top1_correct = sum(1 for r in eval_rows if r.correct_prediction)
    top3_correct = sum(1 for r in eval_rows if r.correct_top3)
    detected_count = sum(1 for r in eval_rows if r.ground_truth_detected)

    top1_accuracy = top1_correct / total_images if total_images else 0.0
    top3_accuracy = top3_correct / total_images if total_images else 0.0
    detection_recall = detected_count / total_images if total_images else 0.0

    all_scores = [s for r in eval_rows for s in r.confidence_scores]
    average_confidence = float(np.mean(all_scores)) if all_scores else 0.0

    per_class_top1: dict[str, float] = {}
    per_class_top3: dict[str, float] = {}
    per_class_recall: dict[str, float] = {}
    per_class_counts: dict[str, dict[str, int]] = {}

    for class_name in TEST_CLASSES:
        class_rows = [r for r in eval_rows if r.ground_truth == class_name]
        n = len(class_rows)
        c1 = sum(1 for r in class_rows if r.correct_prediction)
        c3 = sum(1 for r in class_rows if r.correct_top3)
        cd = sum(1 for r in class_rows if r.ground_truth_detected)

        per_class_top1[class_name] = c1 / n if n else 0.0
        per_class_top3[class_name] = c3 / n if n else 0.0
        per_class_recall[class_name] = cd / n if n else 0.0
        per_class_counts[class_name] = {
            "total": n,
            "top1_correct": c1,
            "top3_correct": c3,
            "detected": cd,
        }

    false_positives = sum(
        1 for r in eval_rows
        if r.num_detections > 0 and not r.correct_prediction
    )
    false_negatives = sum(
        1 for r in eval_rows
        if not r.ground_truth_detected
    )

    return {
        "timestamp": datetime.now().isoformat(),
        "model_path": str(MODEL_PATH),
        "device": str(device),
        "confidence_threshold": confidence_threshold,
        "total_images": total_images,
        "images_with_detections": images_with_detections,
        "images_without_detections": total_images - images_with_detections,
        "top1_accuracy": round(top1_accuracy, 4),
        "top3_accuracy": round(top3_accuracy, 4),
        "detection_recall": round(detection_recall, 4),
        "overall_accuracy": round(top1_accuracy, 4),
        "average_confidence": round(average_confidence, 4),
        "per_class_top1_accuracy": {k: round(v, 4) for k, v in per_class_top1.items()},
        "per_class_top3_accuracy": {k: round(v, 4) for k, v in per_class_top3.items()},
        "per_class_detection_recall": {k: round(v, 4) for k, v in per_class_recall.items()},
        "per_class_accuracy": {k: round(v, 4) for k, v in per_class_top1.items()},
        "per_class_counts": per_class_counts,
        "false_positives": false_positives,
        "false_negatives": false_negatives,
        "top1_correct": top1_correct,
        "top3_correct": top3_correct,
        "detected_count": detected_count,
    }


def save_confusion_matrix(rows: list[EvalRow], output_path: Path) -> None:
    y_true = [r.ground_truth for r in rows if r.ground_truth in TEST_CLASSES]
    y_pred = [
        model_label_to_folder(r.top_prediction) if r.top_prediction else "none"
        for r in rows
        if r.ground_truth in TEST_CLASSES
    ]

    if not y_true:
        logger.warning("No labeled rows for confusion matrix")
        return

    cm = confusion_matrix(y_true, y_pred, labels=CONFUSION_LABELS)
    fig, ax = plt.subplots(figsize=(10, 8))
    sns.heatmap(
        cm,
        annot=True,
        fmt="d",
        cmap="Blues",
        xticklabels=CONFUSION_LABELS,
        yticklabels=CONFUSION_LABELS,
        ax=ax,
    )
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Ground Truth")
    ax.set_title("Car Damage Model — Confusion Matrix")
    plt.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)
    logger.info("Confusion matrix saved: %s", output_path)


def generate_html_report(
    rows: list[EvalRow],
    metrics: dict,
    confusion_image: Path,
    html_path: Path,
) -> None:
    mistakes = [
        r for r in rows
        if r.ground_truth in TEST_CLASSES and not r.correct_prediction
    ]
    mistakes = sorted(
        mistakes,
        key=lambda r: r.top_confidence,
        reverse=True,
    )[:20]

    samples = [
        r for r in rows
        if r.annotated_path and r.ground_truth in TEST_CLASSES
    ][:12]

    per_class_rows = "".join(
        f"<tr><td>{cls}</td>"
        f"<td>{metrics['per_class_top1_accuracy'].get(cls, 0):.1%}</td>"
        f"<td>{metrics['per_class_top3_accuracy'].get(cls, 0):.1%}</td>"
        f"<td>{metrics['per_class_detection_recall'].get(cls, 0):.1%}</td>"
        f"<td>{metrics['per_class_counts'].get(cls, {}).get('total', 0)}</td></tr>"
        for cls in TEST_CLASSES
    )

    mistake_rows = "".join(
        f"<tr><td>{m.image_name}</td><td>{m.ground_truth}</td>"
        f"<td>{m.top_prediction or 'none'}</td>"
        f"<td>{';'.join(m.predicted_classes) or 'none'}</td>"
        f"<td>{'Yes' if m.ground_truth_detected else 'No'}</td>"
        f"<td>{m.top_confidence:.1%}</td></tr>"
        for m in mistakes
    ) or "<tr><td colspan='6'>No top-1 mistakes — perfect run!</td></tr>"

    sample_cards = ""
    for sample in samples:
        rel_img = Path(sample.annotated_path).as_posix()
        sample_cards += f"""
        <div class="card sample">
          <img src="../{rel_img}" alt="{sample.image_name}" />
          <p><strong>{sample.image_name}</strong></p>
          <p>GT: {sample.ground_truth} | Top-1: {sample.top_prediction or 'none'}</p>
          <p>Detected: {'Yes' if sample.ground_truth_detected else 'No'} | Top-1: {'Correct' if sample.correct_prediction else 'Incorrect'}</p>
        </div>
        """

    cm_rel = "../confusion_matrices/confusion_matrix.png"

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Car Damage AI — Evaluation Report</title>
  <style>
    body {{ font-family: Inter, Segoe UI, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }}
    .wrap {{ max-width: 1100px; margin: 0 auto; padding: 32px 20px 60px; }}
    h1 {{ margin-bottom: 8px; }}
    .sub {{ color: #64748b; margin-bottom: 28px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }}
    .card {{ background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }}
    .metric {{ font-size: 28px; font-weight: 700; color: #2563eb; }}
    table {{ width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; }}
    th, td {{ padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: left; }}
    th {{ background: #f1f5f9; }}
    .samples {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }}
    .sample img {{ width: 100%; border-radius: 10px; background: #e2e8f0; }}
    img.cm {{ max-width: 100%; border-radius: 12px; border: 1px solid #e2e8f0; }}
    section {{ margin-top: 36px; }}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Car Damage AI — Model Evaluation</h1>
    <p class="sub">Generated {metrics['timestamp']} | Threshold {metrics['confidence_threshold']} | Device {metrics['device']}</p>

    <div class="grid">
      <div class="card"><div>Top-1 Accuracy</div><div class="metric">{metrics['top1_accuracy']:.1%}</div></div>
      <div class="card"><div>Top-3 Accuracy</div><div class="metric">{metrics['top3_accuracy']:.1%}</div></div>
      <div class="card"><div>Detection Recall</div><div class="metric">{metrics['detection_recall']:.1%}</div></div>
      <div class="card"><div>Total Images</div><div class="metric">{metrics['total_images']}</div></div>
      <div class="card"><div>Avg Confidence</div><div class="metric">{metrics['average_confidence']:.1%}</div></div>
      <div class="card"><div>False Positives</div><div class="metric">{metrics['false_positives']}</div></div>
      <div class="card"><div>False Negatives</div><div class="metric">{metrics['false_negatives']}</div></div>
    </div>

    <section>
      <h2>Per-Class Metrics</h2>
      <table>
        <thead><tr><th>Class</th><th>Top-1</th><th>Top-3</th><th>Recall</th><th>Total</th></tr></thead>
        <tbody>{per_class_rows}</tbody>
      </table>
    </section>

    <section>
      <h2>Confusion Matrix</h2>
      <img class="cm" src="{cm_rel}" alt="Confusion matrix" />
    </section>

    <section>
      <h2>Top 20 Top-1 Mistakes</h2>
      <table>
        <thead><tr><th>Image</th><th>Ground Truth</th><th>Top-1 Pred</th><th>All Preds</th><th>GT Detected</th><th>Confidence</th></tr></thead>
        <tbody>{mistake_rows}</tbody>
      </table>
    </section>

    <section>
      <h2>Sample Annotated Predictions</h2>
      <div class="samples">{sample_cards}</div>
    </section>
  </div>
</body>
</html>
"""
    html_path.write_text(html, encoding="utf-8")
    logger.info("HTML report saved: %s", html_path)


def print_final_summary(
    metrics: dict,
    csv_path: Path,
    html_path: Path,
    confusion_path: Path,
) -> None:
    print()
    print("=" * 48)
    print("MODEL EVALUATION SUMMARY")
    print("=" * 48)
    print(f"Total Images:       {metrics['total_images']}")
    print(f"Top-1 Accuracy:     {metrics['top1_accuracy']:.1%}")
    print(f"Top-3 Accuracy:     {metrics['top3_accuracy']:.1%}")
    print(f"Detection Recall:   {metrics['detection_recall']:.1%}")
    print(f"Average Confidence: {metrics['average_confidence']:.1%}")
    print()
    print("Per-Class Top-1 Accuracy:")
    for cls in TEST_CLASSES:
        acc = metrics["per_class_top1_accuracy"].get(cls, 0.0)
        print(f"  {cls}: {acc:.1%}")
    print()
    print("Per-Class Detection Recall:")
    for cls in TEST_CLASSES:
        rec = metrics["per_class_detection_recall"].get(cls, 0.0)
        print(f"  {cls}: {rec:.1%}")
    print()
    print(f"Report:             {html_path}")
    print(f"CSV:                {csv_path}")
    print(f"Confusion Matrix:   {confusion_path}")
    print("=" * 48)


def run_evaluation(
    input_dir: Path,
    device: str | int,
    confidence: float,
) -> None:
    from ultralytics import YOLO

    ensure_output_dirs()
    ensure_model_exists()

    samples = collect_labeled_images(input_dir)
    if not samples:
        logger.error("No images found under %s", input_dir)
        sys.exit(1)

    logger.info("Loading model from %s", MODEL_PATH)
    model = YOLO(str(MODEL_PATH))
    logger.info("Evaluating %d image(s) | device=%s | conf=%.2f", len(samples), device, confidence)

    rows: list[EvalRow] = []

    for idx, (image_path, ground_truth) in enumerate(samples, start=1):
        logger.info("[%d/%d] %s (ground truth: %s)", idx, len(samples), image_path.name, ground_truth)

        try:
            result = run_inference(model, image_path, device, confidence)
        except Exception as exc:
            logger.error("Failed on %s: %s", image_path.name, exc)
            rows.append(EvalRow(
                image_name=image_path.name,
                image_path=str(image_path),
                ground_truth=ground_truth,
            ))
            continue

        classes, scores = extract_detections(result, confidence)
        top_pred, top_conf = pick_top_prediction(classes, scores)
        is_labeled = ground_truth in TEST_CLASSES
        correct_top1 = labels_match(ground_truth, top_pred) if is_labeled else False
        correct_top3 = is_top3_correct(ground_truth, classes, scores)
        gt_detected = (
            ground_truth_in_predictions(ground_truth, classes) if is_labeled else False
        )

        annotated_rel = ""
        if result is not None:
            annotated = result.plot()
            annotated_name = f"{ground_truth}_{image_path.stem}_annotated.jpg"
            annotated_file = ANNOTATED_DIR / annotated_name
            cv2.imwrite(str(annotated_file), annotated)
            annotated_rel = f"annotated/{annotated_name}"
            logger.info("Saved annotated image: %s", annotated_file.name)

        rows.append(EvalRow(
            image_name=image_path.name,
            image_path=str(image_path),
            ground_truth=ground_truth,
            predicted_classes=classes,
            confidence_scores=scores,
            top_prediction=top_pred,
            top_confidence=top_conf,
            correct_prediction=correct_top1,
            correct_top3=correct_top3,
            ground_truth_detected=gt_detected,
            num_detections=len(classes),
            annotated_path=annotated_rel,
        ))

    metrics = compute_metrics(rows, confidence, device)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = REPORTS_DIR / f"evaluation_results_{timestamp}.csv"
    metrics_path = REPORTS_DIR / "metrics_summary.json"
    confusion_path = CONFUSION_DIR / "confusion_matrix.png"
    html_path = REPORTS_DIR / "report.html"

    df = pd.DataFrame([
        {
            "image_name": r.image_name,
            "ground_truth": r.ground_truth,
            "predicted_classes": ";".join(r.predicted_classes),
            "confidence_scores": ";".join(str(s) for s in r.confidence_scores),
            "top_prediction": r.top_prediction,
            "correct_prediction": r.correct_prediction,
            "correct_top3": r.correct_top3,
            "ground_truth_detected": r.ground_truth_detected,
            "num_detections": r.num_detections,
        }
        for r in rows
    ])
    df.to_csv(csv_path, index=False)
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    if any(r.ground_truth in TEST_CLASSES for r in rows):
        save_confusion_matrix(rows, confusion_path)
    else:
        confusion_path = Path("N/A")

    generate_html_report(rows, metrics, confusion_path, html_path)
    print_final_summary(metrics, csv_path, html_path, confusion_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate car damage YOLO model on structured test_images/ dataset.",
    )
    parser.add_argument(
        "--input", "-i",
        required=True,
        type=Path,
        help="Root folder with class subfolders (e.g. test_images)",
    )
    parser.add_argument(
        "--device", "-d",
        default=None,
        help='Inference device: "0" for GPU, "cpu" for CPU',
    )
    parser.add_argument(
        "--confidence", "-c",
        type=float,
        default=0.25,
        help="Confidence threshold (default: 0.25)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    device = resolve_device(args.device)
    run_evaluation(
        input_dir=args.input.resolve(),
        device=device,
        confidence=args.confidence,
    )


if __name__ == "__main__":
    main()
