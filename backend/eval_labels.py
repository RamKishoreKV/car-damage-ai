"""Shared label mappings for evaluation pipeline."""

# Folder names under test_images/
TEST_CLASSES = [
    "dent",
    "scratch",
    "crack",
    "broken_lamp",
    "glass_shatter",
    "flat_tire",
]

# Map test folder name -> YOLO model class name
FOLDER_TO_MODEL_LABEL = {
    "dent": "dent",
    "scratch": "scratch",
    "crack": "crack",
    "broken_lamp": "lamp broken",
    "glass_shatter": "glass shatter",
    "flat_tire": "tire flat",
}

MODEL_LABEL_TO_FOLDER = {v: k for k, v in FOLDER_TO_MODEL_LABEL.items()}


def normalize_label(label: str) -> str:
    return label.strip().lower().replace("_", " ")


def folder_to_model_label(folder_name: str) -> str:
    return FOLDER_TO_MODEL_LABEL.get(folder_name, folder_name.replace("_", " "))


def model_label_to_folder(model_label: str) -> str:
    norm = normalize_label(model_label)
    for model_name, folder in MODEL_LABEL_TO_FOLDER.items():
        if normalize_label(model_name) == norm:
            return folder
    return norm.replace(" ", "_")


def labels_match(ground_truth_folder: str, predicted_label: str) -> bool:
    if not predicted_label:
        return False
    expected = folder_to_model_label(ground_truth_folder)
    return normalize_label(predicted_label) == normalize_label(expected)


def ground_truth_in_predictions(ground_truth_folder: str, predicted_labels: list[str]) -> bool:
    """True when the ground-truth class appears anywhere in the prediction list."""
    return any(labels_match(ground_truth_folder, pred) for pred in predicted_labels)
