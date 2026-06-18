/**
 * Rule-based vehicle part inference from bbox position and image dimensions.
 * Designed to be swappable with a future ML-based part detection model.
 *
 * Capture resolution order:
 *   1. User-selected view (when not Auto)
 *   2. Robot capture metadata (e.g. { view: "front" })
 *   3. Auto heuristics (conservative — may resolve to Unknown)
 */

export const VEHICLE_VIEWS = {
  AUTO: "auto",
  FRONT: "front",
  REAR: "rear",
  LEFT_SIDE: "left_side",
  RIGHT_SIDE: "right_side",
  SIDE: "side",
  WHEEL_CLOSEUP: "wheel_closeup",
  LIGHT_CLOSEUP: "light_closeup",
  UNKNOWN: "unknown",
};

/** Coarse labels returned by Auto detection only — never Left/Right Side. */
export const AUTO_DETECTED_VIEWS = {
  FRONT: "front",
  REAR: "rear",
  SIDE: "side",
  UNKNOWN: "unknown",
};

export const VEHICLE_VIEW_OPTIONS = [
  { value: VEHICLE_VIEWS.FRONT, label: "Front" },
  { value: VEHICLE_VIEWS.REAR, label: "Rear" },
  { value: VEHICLE_VIEWS.LEFT_SIDE, label: "Left Side" },
  { value: VEHICLE_VIEWS.RIGHT_SIDE, label: "Right Side" },
  { value: VEHICLE_VIEWS.WHEEL_CLOSEUP, label: "Wheel Close-up" },
  { value: VEHICLE_VIEWS.LIGHT_CLOSEUP, label: "Light Close-up" },
  { value: VEHICLE_VIEWS.AUTO, label: "Auto" },
];

export const AUTO_VIEW_WARNING =
  "Auto view is approximate. For accurate inspection reports, select the capture view manually or provide robot capture metadata.";

export const UNKNOWN_VIEW_RECOMMENDATION =
  "Vehicle view could not be determined reliably. Select Front, Rear, Side, or a close-up view for accurate part mapping.";

export const PART_LOCALIZATION_HELPER =
  "Vehicle part labels use the optional part detection model when available; otherwise bbox + view heuristics.";

export const POTENTIAL_FINDINGS_TITLE = "Potential Findings — Needs Verification";

export const BROAD_MASK_MESSAGE =
  "Model produced a broad damage mask. Multiple damaged vehicle regions may be present. Close-up images are recommended for part-level confirmation.";

const AUTO_VIEW_CONFIDENCE_THRESHOLD = 0.55;
const BROAD_DETECTION_THRESHOLD = 0.5;

const VIEW_LABELS = {
  [VEHICLE_VIEWS.FRONT]: "Front",
  [VEHICLE_VIEWS.REAR]: "Rear",
  [VEHICLE_VIEWS.LEFT_SIDE]: "Left Side",
  [VEHICLE_VIEWS.RIGHT_SIDE]: "Right Side",
  [VEHICLE_VIEWS.SIDE]: "Side",
  [VEHICLE_VIEWS.WHEEL_CLOSEUP]: "Wheel Close-up",
  [VEHICLE_VIEWS.LIGHT_CLOSEUP]: "Light Close-up",
  [VEHICLE_VIEWS.UNKNOWN]: "Unknown",
  [AUTO_DETECTED_VIEWS.FRONT]: "Front",
  [AUTO_DETECTED_VIEWS.REAR]: "Rear",
  [AUTO_DETECTED_VIEWS.SIDE]: "Side",
  [AUTO_DETECTED_VIEWS.UNKNOWN]: "Unknown",
};

const METADATA_VIEW_ALIASES = {
  front: VEHICLE_VIEWS.FRONT,
  rear: VEHICLE_VIEWS.REAR,
  left_side: VEHICLE_VIEWS.LEFT_SIDE,
  left: VEHICLE_VIEWS.LEFT_SIDE,
  right_side: VEHICLE_VIEWS.RIGHT_SIDE,
  right: VEHICLE_VIEWS.RIGHT_SIDE,
  side: VEHICLE_VIEWS.SIDE,
  wheel_closeup: VEHICLE_VIEWS.WHEEL_CLOSEUP,
  wheel: VEHICLE_VIEWS.WHEEL_CLOSEUP,
  light_closeup: VEHICLE_VIEWS.LIGHT_CLOSEUP,
  light: VEHICLE_VIEWS.LIGHT_CLOSEUP,
};

const FRONT_VIEW_ADDITIONAL_AREAS = [
  "Hood",
  "Front bumper",
  "Grille",
  "Left headlight",
  "Right headlight",
  "Front fender",
];

const SIDE_VIEW_ADDITIONAL_AREAS = [
  "Door panel",
  "Fender",
  "Rocker panel",
  "Wheel / tire area",
];

const UNKNOWN_VIEW_ADDITIONAL_AREAS = [
  "Unspecified body panel",
  "Unspecified lighting area",
  "Unspecified lower vehicle area",
];

const FRONT_VIEW_RECOMMENDED_CAPTURES = [
  "Capture hood close-up",
  "Capture front bumper close-up",
  "Capture left headlight close-up",
  "Capture right headlight close-up",
  "Capture grille close-up",
];

const SIDE_VIEW_RECOMMENDED_CAPTURES = [
  "Capture front door close-up",
  "Capture rear door close-up",
  "Capture wheel / tire close-up",
  "Capture fender close-up",
];

const UNKNOWN_VIEW_RECOMMENDED_CAPTURES = [
  "Select vehicle capture view for accurate part mapping",
  "Capture front, side, and rear angles",
  "Provide robot capture metadata when available",
];

/**
 * @typedef {Object} CaptureMetadata
 * @property {string} [view] Robot-provided view key, e.g. "front", "left_side", "wheel_closeup"
 */

/**
 * @typedef {Object} CaptureContext
 * @property {string} effectiveView Resolved view used for part mapping
 * @property {string} resolvedViewLabel Human-readable view label
 * @property {'user'|'metadata'|'auto'} source How the view was resolved
 * @property {boolean} isAutoMode User left selector on Auto
 * @property {boolean} isUnknownView Part mapping should stay generic
 * @property {boolean} showAutoWarning Show Auto approximation warning
 * @property {{ view: string, confidence: number, reason: string }|null} autoDetection
 */

function bboxCoverage(bbox, imageWidth, imageHeight) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !imageWidth || !imageHeight) return 0;
  const [x1, y1, x2, y2] = bbox;
  const area = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return area / (imageWidth * imageHeight);
}

function isCroppedOrCloseup(imageWidth, imageHeight, bbox) {
  if (!imageWidth || !imageHeight) return true;
  const aspect = imageWidth / imageHeight;
  if (aspect >= 0.85 && aspect <= 1.15) return true;
  return bboxCoverage(bbox, imageWidth, imageHeight) >= 0.35;
}

const SIDE_NEUTRAL_LABELS = {
  "Left headlight / left fender": "Headlight assembly",
  "Right headlight / right fender": "Headlight assembly",
  "Left tail light / rear fender": "Taillight assembly",
  "Right tail light / rear fender": "Taillight assembly",
  "Windshield / A-pillar area (left)": "Windshield / A-pillar area",
  "Windshield / A-pillar area (right)": "Windshield / A-pillar area",
  "Fog light / bumper corner / wheel edge (left)": "Front bumper corner area",
  "Fog light / bumper corner / wheel edge (right)": "Front bumper corner area",
  "Rear bumper corner / wheel edge (left)": "Rear bumper corner area",
  "Rear bumper corner / wheel edge (right)": "Rear bumper corner area",
  "Left rear quarter": "Rear quarter panel",
  "Right rear quarter": "Rear quarter panel",
};

function shouldAvoidSideClaims(effectiveView, imageWidth, imageHeight, bbox) {
  if (
    effectiveView === VEHICLE_VIEWS.WHEEL_CLOSEUP ||
    effectiveView === VEHICLE_VIEWS.LIGHT_CLOSEUP ||
    effectiveView === VEHICLE_VIEWS.UNKNOWN
  ) {
    return true;
  }
  if (effectiveView !== VEHICLE_VIEWS.FRONT && effectiveView !== VEHICLE_VIEWS.REAR) {
    return false;
  }
  return isCroppedOrCloseup(imageWidth, imageHeight, bbox);
}

function applySideClaimCaution(partLabel, effectiveView, imageWidth, imageHeight, bbox) {
  if (!shouldAvoidSideClaims(effectiveView, imageWidth, imageHeight, bbox)) {
    return partLabel;
  }
  return SIDE_NEUTRAL_LABELS[partLabel] ?? partLabel.replace(/^Left |^Right /, "");
}

export function getViewLabel(view) {
  return VIEW_LABELS[view] ?? "Unknown";
}

/**
 * Normalize robot capture metadata view strings to internal view keys.
 * @param {string|undefined|null} view
 * @returns {string|null}
 */
export function normalizeMetadataView(view) {
  if (!view) return null;
  const key = String(view).toLowerCase().trim().replace(/[\s-]+/g, "_");
  return METADATA_VIEW_ALIASES[key] ?? null;
}

/**
 * Conservative Auto detection — returns coarse Front | Rear | Side | Unknown only.
 * Does not distinguish left vs right side.
 */
export function detectVehicleViewAuto(imageWidth, imageHeight) {
  if (!imageWidth || !imageHeight) {
    return {
      view: AUTO_DETECTED_VIEWS.UNKNOWN,
      confidence: 0,
      reason: "missing_image_dimensions",
    };
  }

  const aspect = imageWidth / imageHeight;

  if (aspect >= 1.7) {
    return {
      view: AUTO_DETECTED_VIEWS.SIDE,
      confidence: 0.62,
      reason: "strong_wide_landscape",
    };
  }

  if (aspect >= 1.5) {
    return {
      view: AUTO_DETECTED_VIEWS.SIDE,
      confidence: 0.48,
      reason: "moderate_wide_landscape",
    };
  }

  if (aspect <= 0.68) {
    return {
      view: AUTO_DETECTED_VIEWS.FRONT,
      confidence: 0.58,
      reason: "strong_portrait",
    };
  }

  if (aspect >= 0.9 && aspect <= 1.1) {
    return {
      view: AUTO_DETECTED_VIEWS.UNKNOWN,
      confidence: 0,
      reason: "square_aspect_ambiguous",
    };
  }

  if (aspect > 1.1 && aspect < 1.5) {
    return {
      view: AUTO_DETECTED_VIEWS.UNKNOWN,
      confidence: 0.3,
      reason: "landscape_ambiguous",
    };
  }

  if (aspect > 0.68 && aspect < 0.9) {
    return {
      view: AUTO_DETECTED_VIEWS.UNKNOWN,
      confidence: 0.32,
      reason: "portrait_ambiguous",
    };
  }

  return {
    view: AUTO_DETECTED_VIEWS.UNKNOWN,
    confidence: 0,
    reason: "insufficient_signal",
  };
}

function mapAutoCoarseToEffectiveView(coarseView) {
  switch (coarseView) {
    case AUTO_DETECTED_VIEWS.FRONT:
      return VEHICLE_VIEWS.FRONT;
    case AUTO_DETECTED_VIEWS.REAR:
      return VEHICLE_VIEWS.REAR;
    case AUTO_DETECTED_VIEWS.SIDE:
      return VEHICLE_VIEWS.SIDE;
    default:
      return VEHICLE_VIEWS.UNKNOWN;
  }
}

/**
 * Resolve the effective capture view for inspection reporting.
 * @param {Object} params
 * @param {string} [params.userVehicleView]
 * @param {number} [params.imageWidth]
 * @param {number} [params.imageHeight]
 * @param {CaptureMetadata|null} [params.captureMetadata]
 * @returns {CaptureContext}
 */
export function resolveCaptureContext({
  userVehicleView = VEHICLE_VIEWS.AUTO,
  imageWidth = 0,
  imageHeight = 0,
  captureMetadata = null,
} = {}) {
  if (userVehicleView && userVehicleView !== VEHICLE_VIEWS.AUTO) {
    return {
      effectiveView: userVehicleView,
      resolvedViewLabel: getViewLabel(userVehicleView),
      source: "user",
      isAutoMode: false,
      isUnknownView: false,
      showAutoWarning: false,
      autoDetection: null,
    };
  }

  const metadataView = normalizeMetadataView(captureMetadata?.view);
  if (metadataView) {
    return {
      effectiveView: metadataView,
      resolvedViewLabel: getViewLabel(metadataView),
      source: "metadata",
      isAutoMode: false,
      isUnknownView: false,
      showAutoWarning: false,
      autoDetection: null,
    };
  }

  const autoDetection = detectVehicleViewAuto(imageWidth, imageHeight);
  const isConfident = autoDetection.confidence >= AUTO_VIEW_CONFIDENCE_THRESHOLD;
  const coarseView = isConfident ? autoDetection.view : AUTO_DETECTED_VIEWS.UNKNOWN;
  const effectiveView = mapAutoCoarseToEffectiveView(coarseView);
  const isUnknownView = effectiveView === VEHICLE_VIEWS.UNKNOWN;

  return {
    effectiveView,
    resolvedViewLabel: isUnknownView
      ? "Unknown"
      : `${getViewLabel(coarseView)} (auto)`,
    source: "auto",
    isAutoMode: true,
    isUnknownView,
    showAutoWarning: true,
    autoDetection: {
      ...autoDetection,
      coarseView,
    },
  };
}

/**
 * Normalized bbox center and 3x3 grid zone (upper|middle|lower)-(left|middle|right).
 */
export function getBboxGridPosition(bbox, imageWidth, imageHeight) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !imageWidth || !imageHeight) {
    return null;
  }

  const [x1, y1, x2, y2] = bbox;
  const cx = (x1 + x2) / 2 / imageWidth;
  const cy = (y1 + y2) / 2 / imageHeight;

  const vertical = cy < 0.33 ? "upper" : cy > 0.66 ? "lower" : "middle";
  const horizontal = cx < 0.33 ? "left" : cx > 0.66 ? "right" : "middle";

  return { cx, cy, vertical, horizontal, zone: `${vertical}-${horizontal}` };
}

function inferGenericDamagedRegion(position) {
  const { vertical, horizontal } = position;

  if (vertical === "middle" && horizontal === "middle") {
    return "Central damaged vehicle region";
  }
  if (vertical === "upper" && horizontal === "middle") {
    return "Upper damaged vehicle region";
  }
  if (vertical === "lower" && horizontal === "middle") {
    return "Lower damaged vehicle region";
  }
  if (horizontal === "left") return "Left damaged vehicle region";
  if (horizontal === "right") return "Right damaged vehicle region";
  if (vertical === "upper") return "Upper damaged vehicle region";
  if (vertical === "lower") return "Lower damaged vehicle region";
  return "Damaged vehicle region";
}

function inferFrontViewPart(position) {
  const { vertical, horizontal } = position;

  if (vertical === "upper" && horizontal === "middle") return "Hood";
  if (vertical === "upper" && horizontal === "left") {
    return "Windshield / A-pillar area (left)";
  }
  if (vertical === "upper" && horizontal === "right") {
    return "Windshield / A-pillar area (right)";
  }
  if (vertical === "middle" && horizontal === "left") {
    return "Left headlight / left fender";
  }
  if (vertical === "middle" && horizontal === "right") {
    return "Right headlight / right fender";
  }
  if (vertical === "middle" && horizontal === "middle") return "Grille / front body";
  if (vertical === "lower" && horizontal === "middle") return "Front bumper";
  if (vertical === "lower" && horizontal === "left") {
    return "Fog light / bumper corner / wheel edge (left)";
  }
  if (vertical === "lower" && horizontal === "right") {
    return "Fog light / bumper corner / wheel edge (right)";
  }

  if (vertical === "upper") return "Front upper body";
  if (vertical === "lower") return "Front lower body";
  return "Front central body";
}

function inferGenericSideViewPart(position) {
  const { vertical, horizontal } = position;

  if (vertical === "upper" && horizontal === "middle") return "Window / roofline";
  if (vertical === "middle" && (horizontal === "left" || horizontal === "right")) {
    return "Door / body panel";
  }
  if (vertical === "lower" && (horizontal === "left" || horizontal === "right")) {
    return "Wheel / tire area";
  }
  if (vertical === "lower" && horizontal === "middle") return "Rocker panel / lower body";
  if (vertical === "middle") return "Side body panel";
  if (vertical === "upper") return "Upper side body / window line";
  return "Lower side body";
}

function inferSideViewPart(position, sideView) {
  const { vertical, horizontal } = position;
  const sideLabel = sideView === VEHICLE_VIEWS.RIGHT_SIDE ? "right" : "left";

  if (vertical === "upper" && horizontal === "middle") return "Window / roofline";
  if (vertical === "middle" && horizontal === "left") {
    return sideView === VEHICLE_VIEWS.RIGHT_SIDE
      ? "Rear door / rear quarter panel"
      : "Front door / front fender";
  }
  if (vertical === "middle" && horizontal === "right") {
    return sideView === VEHICLE_VIEWS.RIGHT_SIDE
      ? "Front door / front fender"
      : "Rear door / rear quarter panel";
  }
  if (vertical === "lower" && (horizontal === "left" || horizontal === "right")) {
    return `Wheel / tire area (${sideLabel})`;
  }
  if (vertical === "lower" && horizontal === "middle") return "Rocker panel / lower body";

  if (vertical === "middle") return "Side body panel";
  if (vertical === "upper") return "Upper side body / window line";
  return "Lower side body";
}

function inferRearViewPart(position) {
  const { vertical, horizontal } = position;

  if (vertical === "upper" && horizontal === "middle") return "Rear window / trunk lid";
  if (vertical === "upper" && (horizontal === "left" || horizontal === "right")) {
    return horizontal === "left" ? "Left rear quarter" : "Right rear quarter";
  }
  if (vertical === "middle" && horizontal === "left") return "Left tail light / rear fender";
  if (vertical === "middle" && horizontal === "right") return "Right tail light / rear fender";
  if (vertical === "middle" && horizontal === "middle") return "Rear body / license area";
  if (vertical === "lower" && horizontal === "middle") return "Rear bumper";
  if (vertical === "lower" && horizontal === "left") {
    return "Rear bumper corner / wheel edge (left)";
  }
  if (vertical === "lower" && horizontal === "right") {
    return "Rear bumper corner / wheel edge (right)";
  }

  if (vertical === "upper") return "Rear upper body";
  if (vertical === "lower") return "Rear lower body";
  return "Rear central body";
}

function inferWheelCloseupPart(position) {
  const { vertical, horizontal } = position;

  if (vertical === "middle" && horizontal === "middle") return "Tire tread / wheel center";
  if (vertical === "upper") return "Wheel arch / upper tire";
  if (vertical === "lower") return "Lower tire / rim edge";
  if (horizontal === "left") return "Left wheel / tire section";
  if (horizontal === "right") return "Right wheel / tire section";
  return "Wheel / tire area";
}

function inferLightCloseupPart(position) {
  const { vertical, horizontal } = position;

  if (vertical === "middle" && horizontal === "middle") return "Headlight / lamp lens";
  if (vertical === "upper") return "Upper lamp housing";
  if (vertical === "lower") return "Fog light / lower lamp section";
  if (horizontal === "left") return "Left lamp assembly";
  if (horizontal === "right") return "Right lamp assembly";
  return "Lighting assembly";
}

function inferPartForView(position, effectiveView) {
  switch (effectiveView) {
    case VEHICLE_VIEWS.FRONT:
      return inferFrontViewPart(position);
    case VEHICLE_VIEWS.LEFT_SIDE:
    case VEHICLE_VIEWS.RIGHT_SIDE:
      return inferSideViewPart(position, effectiveView);
    case VEHICLE_VIEWS.SIDE:
      return inferGenericSideViewPart(position);
    case VEHICLE_VIEWS.REAR:
      return inferRearViewPart(position);
    case VEHICLE_VIEWS.WHEEL_CLOSEUP:
      return inferWheelCloseupPart(position);
    case VEHICLE_VIEWS.LIGHT_CLOSEUP:
      return inferLightCloseupPart(position);
    case VEHICLE_VIEWS.UNKNOWN:
      return inferGenericDamagedRegion(position);
    default:
      return inferGenericDamagedRegion(position);
  }
}

/**
 * Primary API: infer human-readable vehicle part label from bbox + resolved capture context.
 */
export function inferLikelyVehiclePart(
  bbox,
  imageWidth,
  imageHeight,
  captureContext,
) {
  const position = getBboxGridPosition(bbox, imageWidth, imageHeight);
  if (!position) return "Damaged vehicle region";

  if (!captureContext || captureContext.isUnknownView) {
    return inferGenericDamagedRegion(position);
  }

  const partLabel = inferPartForView(position, captureContext.effectiveView);
  return applySideClaimCaution(
    partLabel,
    captureContext.effectiveView,
    imageWidth,
    imageHeight,
    bbox,
  );
}

function bboxArea(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return 0;
  const [x1, y1, x2, y2] = bbox;
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

export function isBroadDetection(detections, imageWidth, imageHeight) {
  if (!imageWidth || !imageHeight || !Array.isArray(detections) || detections.length !== 1) {
    return false;
  }
  const imageArea = imageWidth * imageHeight;
  if (!imageArea) return false;
  return bboxArea(detections[0].bbox) / imageArea > BROAD_DETECTION_THRESHOLD;
}

function isExplicitSideView(effectiveView) {
  return (
    effectiveView === VEHICLE_VIEWS.LEFT_SIDE ||
    effectiveView === VEHICLE_VIEWS.RIGHT_SIDE
  );
}

function isSideFamilyView(effectiveView) {
  return effectiveView === VEHICLE_VIEWS.SIDE || isExplicitSideView(effectiveView);
}

export function getPossibleAdditionalDamagedAreas(captureContext) {
  const view = captureContext?.effectiveView ?? VEHICLE_VIEWS.UNKNOWN;

  if (view === VEHICLE_VIEWS.UNKNOWN || captureContext?.isUnknownView) {
    return [...UNKNOWN_VIEW_ADDITIONAL_AREAS];
  }
  if (view === VEHICLE_VIEWS.FRONT) {
    return [...FRONT_VIEW_ADDITIONAL_AREAS];
  }
  if (isSideFamilyView(view)) {
    return [...SIDE_VIEW_ADDITIONAL_AREAS];
  }
  if (view === VEHICLE_VIEWS.REAR) {
    return [
      "Trunk lid",
      "Rear bumper",
      "Left tail light",
      "Right tail light",
      "Rear fender",
    ];
  }
  if (view === VEHICLE_VIEWS.WHEEL_CLOSEUP) {
    return ["Tire tread", "Rim", "Wheel arch", "Brake area"];
  }
  if (view === VEHICLE_VIEWS.LIGHT_CLOSEUP) {
    return ["Lamp lens", "Lamp housing", "Reflector", "Surrounding body panel"];
  }

  return [...UNKNOWN_VIEW_ADDITIONAL_AREAS];
}

export function getRecommendedNextCaptures(captureContext) {
  const view = captureContext?.effectiveView ?? VEHICLE_VIEWS.UNKNOWN;

  if (view === VEHICLE_VIEWS.UNKNOWN || captureContext?.isUnknownView) {
    return [...UNKNOWN_VIEW_RECOMMENDED_CAPTURES];
  }
  if (view === VEHICLE_VIEWS.FRONT) {
    return [...FRONT_VIEW_RECOMMENDED_CAPTURES];
  }
  if (isSideFamilyView(view)) {
    return [...SIDE_VIEW_RECOMMENDED_CAPTURES];
  }
  if (view === VEHICLE_VIEWS.REAR) {
    return [
      "Capture rear bumper close-up",
      "Capture left tail light close-up",
      "Capture right tail light close-up",
      "Capture trunk lid close-up",
    ];
  }
  if (view === VEHICLE_VIEWS.WHEEL_CLOSEUP) {
    return [
      "Capture full wheel profile",
      "Capture tire tread close-up",
      "Capture rim close-up",
    ];
  }
  if (view === VEHICLE_VIEWS.LIGHT_CLOSEUP) {
    return [
      "Capture lamp lens close-up",
      "Capture surrounding body panel",
      "Capture opposite lamp for comparison",
    ];
  }

  return [...UNKNOWN_VIEW_RECOMMENDED_CAPTURES];
}

/** @deprecated Use resolveCaptureContext — kept for gradual migration */
export function resolveVehicleView(userVehicleView, imageWidth, imageHeight, captureMetadata) {
  return resolveCaptureContext({
    userVehicleView,
    imageWidth,
    imageHeight,
    captureMetadata,
  }).effectiveView;
}

/** @deprecated Use resolveCaptureContext */
export function getResolvedViewLabel(userVehicleView, imageWidth, imageHeight, captureMetadata) {
  return resolveCaptureContext({
    userVehicleView,
    imageWidth,
    imageHeight,
    captureMetadata,
  }).resolvedViewLabel;
}
