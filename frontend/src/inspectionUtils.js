import {
  NO_MODEL_DETECTED_DAMAGE_MESSAGE,
  NO_MODEL_DETECTED_FLEET_STATUS,
  NO_MODEL_DETECTED_ZERO_ACTION,
} from "./NoModelDetectedDamage";
import {
  AUTO_VIEW_WARNING,
  BROAD_MASK_MESSAGE,
  getPossibleAdditionalDamagedAreas,
  getRecommendedNextCaptures,
  inferLikelyVehiclePart,
  isBroadDetection,
  resolveCaptureContext,
  UNKNOWN_VIEW_RECOMMENDATION,
  VEHICLE_VIEWS,
} from "./vehiclePartUtils";

export function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, " ");
}

export function formatVehiclePart(part) {
  if (!part) return "Unspecified region";
  return part
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export const LOW_CONFIDENCE_THRESHOLD = 0.4;

const HIGH_RISK_TYPES = new Set([
  "crack",
  "glass shatter",
  "lamp broken",
  "tire flat",
]);

export function isLowConfidence(confidence) {
  return (confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD;
}

export function splitDetectionsByConfidence(detections) {
  const confirmed = [];
  const potential = [];

  for (const det of Array.isArray(detections) ? detections : []) {
    const needsVerification =
      det.verification_required ?? isLowConfidence(det.confidence);
    if (needsVerification) {
      potential.push(det);
    } else {
      confirmed.push(det);
    }
  }

  return { confirmed, potential };
}

export function splitFindingsByConfidence(findings) {
  const confirmed = [];
  const potential = [];

  for (const finding of Array.isArray(findings) ? findings : []) {
    if (finding.verificationRequired ?? isLowConfidence(finding.confidence)) {
      potential.push(finding);
    } else {
      confirmed.push(finding);
    }
  }

  return { confirmed, potential };
}

export function getFindingSeverity(damageType, confidence) {
  const normalized = (damageType || "").toLowerCase().replace(/_/g, " ");
  const conf = confidence || 0;

  if (conf < LOW_CONFIDENCE_THRESHOLD) {
    return "Low";
  }

  if (HIGH_RISK_TYPES.has(normalized) && conf >= 0.7) return "High";
  if (HIGH_RISK_TYPES.has(normalized) || conf >= 0.85) return "Medium";
  return "Low";
}

export function getFindingSuggestedAction(damageType, severity, confidence) {
  const type = capitalize(damageType);

  if (isLowConfidence(confidence)) {
    return `Low-confidence ${type.toLowerCase()} detection — capture a closer photo to verify before escalating severity.`;
  }

  if (severity === "High") {
    if (type.toLowerCase().includes("glass")) {
      return "Escalate for immediate glass and safety inspection before fleet release.";
    }
    if (type.toLowerCase().includes("tire")) {
      return "Remove from active dispatch and inspect tire integrity before reuse.";
    }
    if (type.toLowerCase().includes("lamp")) {
      return "Schedule lighting repair to maintain roadworthiness compliance.";
    }
    return "Prioritize technician review and document before returning to service.";
  }

  if (severity === "Medium") {
    return `Schedule maintenance review for ${type.toLowerCase()} and capture close-up photos.`;
  }

  return `Monitor ${type.toLowerCase()} during routine inspections and repair if it worsens.`;
}

export function buildFindings(detections, imageSize, captureContext) {
  const { width = 0, height = 0 } = imageSize || {};

  return (Array.isArray(detections) ? detections : []).map((det, index) => {
    const confidence = det.confidence ?? 0;
    const verificationRequired =
      det.verification_required ?? isLowConfidence(confidence);
    const severity = getFindingSeverity(det.damage_type, confidence);

    return {
      id: index + 1,
      damageType: capitalize(det.damage_type),
      confidence,
      bbox: det.bbox ?? [],
      hasMask: Boolean(det.has_mask),
      likelyVehiclePart: det.vehicle_part
        ? formatVehiclePart(det.vehicle_part)
        : inferLikelyVehiclePart(det.bbox, width, height, captureContext),
      partConfidence: det.part_confidence ?? null,
      localizationMethod: det.localization_method ?? null,
      severity,
      verificationRequired,
      confidenceTier: verificationRequired ? "low" : "confirmed",
      findingType: verificationRequired ? "Potential Finding" : "Confirmed Finding",
      suggestedAction: getFindingSuggestedAction(
        det.damage_type,
        severity,
        confidence,
      ),
    };
  });
}

export function deriveInspectionReport(
  detections,
  imageSize,
  userVehicleView = VEHICLE_VIEWS.AUTO,
  captureMetadata = null,
) {
  const items = Array.isArray(detections) ? detections : [];
  const { width = 0, height = 0 } = imageSize || {};
  const captureContext = resolveCaptureContext({
    userVehicleView,
    imageWidth: width,
    imageHeight: height,
    captureMetadata,
  });
  const allFindings = buildFindings(items, imageSize, captureContext);
  const { confirmed: confirmedFindings, potential: potentialFindings } =
    splitFindingsByConfidence(allFindings);
  const totalDamagesDetected = confirmedFindings.length;
  const potentialFindingsCount = potentialFindings.length;
  const broadDetectionWarning = isBroadDetection(items, width, height);

  const possibleAdditionalDamagedAreas = broadDetectionWarning
    ? getPossibleAdditionalDamagedAreas(captureContext)
    : [];

  const recommendedNextCaptures =
    broadDetectionWarning || captureContext.isUnknownView
      ? getRecommendedNextCaptures(captureContext)
      : [];

  const viewSelectionRecommendation = captureContext.isUnknownView
    ? UNKNOWN_VIEW_RECOMMENDATION
    : "";

  if (confirmedFindings.length === 0 && potentialFindings.length === 0) {
    return {
      totalDamagesDetected: 0,
      potentialFindingsCount: 0,
      overallSeverity: "None",
      damageSummary: NO_MODEL_DETECTED_DAMAGE_MESSAGE,
      suggestedAction: NO_MODEL_DETECTED_ZERO_ACTION,
      fleetInspectionStatus: NO_MODEL_DETECTED_FLEET_STATUS,
      findings: [],
      confirmedFindings: [],
      potentialFindings: [],
      broadDetectionWarning: false,
      broadMaskMessage: "",
      possibleAdditionalDamagedAreas: [],
      recommendedNextCaptures: [],
      captureContext,
      resolvedViewLabel: captureContext.resolvedViewLabel,
      vehicleView: userVehicleView,
      isAutoMode: captureContext.isAutoMode,
      isUnknownView: captureContext.isUnknownView,
      showAutoWarning: captureContext.showAutoWarning,
      autoViewWarning: captureContext.showAutoWarning ? AUTO_VIEW_WARNING : "",
      viewSelectionRecommendation,
    };
  }

  const severities = confirmedFindings.map((f) => f.severity);
  const averageConfidence =
    confirmedFindings.length > 0
      ? confirmedFindings.reduce((sum, f) => sum + f.confidence, 0) /
        confirmedFindings.length
      : 0;

  let overallSeverity = "Low";
  if (confirmedFindings.length === 0) {
    overallSeverity = "Low";
  } else if (severities.includes("High") || confirmedFindings.length >= 4) {
    overallSeverity = "High";
  } else if (severities.includes("Medium") || confirmedFindings.length >= 2) {
    overallSeverity = "Medium";
  }

  let suggestedAction =
    "Review all listed findings and route the vehicle through fleet maintenance triage.";
  let fleetInspectionStatus = "Review Recommended";

  if (overallSeverity === "High") {
    suggestedAction =
      "Escalate for technician review before returning the vehicle to active fleet use.";
    fleetInspectionStatus = "Hold for Manual Inspection";
  } else if (overallSeverity === "Medium") {
    suggestedAction =
      "Schedule maintenance review and document each finding before the next dispatch.";
    fleetInspectionStatus = "Needs Service Review";
  } else if (confirmedFindings.length === 0 && potentialFindings.length > 0) {
    suggestedAction =
      "Only low-confidence detections found — verify with closer photos before changing fleet status.";
    fleetInspectionStatus = "Verification Recommended";
  } else {
    fleetInspectionStatus = "Operational with Minor Damage";
  }

  const damageParts = [];
  if (confirmedFindings.length > 0) {
    damageParts.push(
      `${confirmedFindings.length} confirmed finding${confirmedFindings.length === 1 ? "" : "s"}`,
    );
  }
  if (potentialFindings.length > 0) {
    damageParts.push(
      `${potentialFindings.length} potential finding${potentialFindings.length === 1 ? "" : "s"} requiring verification`,
    );
  }
  const damageSummary = `${damageParts.join(" and ")}. Manual review recommended for multi-damage areas.`;

  return {
    totalDamagesDetected,
    potentialFindingsCount,
    overallSeverity,
    damageSummary,
    suggestedAction,
    fleetInspectionStatus,
    findings: confirmedFindings,
    confirmedFindings,
    potentialFindings,
    broadDetectionWarning,
    broadMaskMessage: broadDetectionWarning ? BROAD_MASK_MESSAGE : "",
    possibleAdditionalDamagedAreas,
    recommendedNextCaptures,
    captureContext,
    resolvedViewLabel: captureContext.resolvedViewLabel,
    vehicleView: userVehicleView,
    isAutoMode: captureContext.isAutoMode,
    isUnknownView: captureContext.isUnknownView,
    showAutoWarning: captureContext.showAutoWarning,
    autoViewWarning: captureContext.showAutoWarning ? AUTO_VIEW_WARNING : "",
    viewSelectionRecommendation,
    averageConfidence,
  };
}

export function loadImageSize(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve({ width: 0, height: 0 });
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}

export function severityBadgeClass(severity) {
  if (severity === "High") return "bg-red-100 text-red-700 ring-1 ring-red-200/60";
  if (severity === "Medium") return "bg-amber-100 text-amber-800 ring-1 ring-amber-200/60";
  if (severity === "Low") return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/60";
  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200/60";
}

export function potentialFindingBadgeClass() {
  return "bg-violet-100 text-violet-800 ring-1 ring-violet-200/60";
}

export function localizationMethodLabel(method) {
  if (method === "part_model_overlap") return "Part Model Verified";
  if (method === "rule_based_bbox") return "Rule-Based Estimate";
  return method ? capitalize(String(method).replace(/_/g, " ")) : "—";
}

export function localizationMethodBadgeClass(method) {
  if (method === "part_model_overlap") {
    return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/60";
  }
  return "bg-sky-100 text-sky-800 ring-1 ring-sky-200/60";
}

export function verificationRequiredBadgeClass() {
  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200/60";
}
