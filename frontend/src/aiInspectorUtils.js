import { getFindingSeverity } from "./inspectionUtils";
import { AI_INSPECTION_SUMMARY_ENDPOINT } from "./config";

export const FLEET_DECISION_STYLES = {
  "Safe to Operate": "bg-emerald-100 text-emerald-800",
  "Maintenance Review Recommended": "bg-amber-100 text-amber-800",
  "Do Not Deploy": "bg-red-100 text-red-800",
};

export function fleetDecisionBadgeClass(decision) {
  return FLEET_DECISION_STYLES[decision] || "bg-slate-100 text-slate-700";
}

export function buildSingleAiContext({
  vehicleId,
  inspectionId,
  view,
  detections,
  inspectionReport,
}) {
  const normalizedView = view || "unknown";
  return {
    vehicle_id: vehicleId?.trim() || "UNASSIGNED",
    inspection_id: inspectionId || "",
    mode: "single",
    views_inspected: [normalizedView],
    detections: (detections || []).map((det) => ({
      view: normalizedView,
      damage_type: det.damage_type,
      confidence: det.confidence ?? 0,
      severity: getFindingSeverity(det.damage_type, det.confidence),
      vehicle_part: det.vehicle_part || null,
      part_confidence: det.part_confidence ?? null,
      bbox: det.bbox,
    })),
    overall_severity: inspectionReport?.overallSeverity || "None",
    fleet_status: inspectionReport?.fleetInspectionStatus || "",
  };
}

export function buildMultiviewAiContext({ vehicleId, result }) {
  const summary = result?.vehicle_level_summary;
  const combined = result?.combined_report;
  return {
    vehicle_id: vehicleId?.trim() || "UNASSIGNED",
    inspection_id: result?.inspection_id || "",
    mode: "multiview",
    views_inspected: summary?.views_inspected || [],
    detections: (combined?.items || []).map((item) => ({
      view: item.view,
      damage_type: item.damage_type,
      confidence: item.confidence ?? 0,
      severity: item.severity || "Low",
      vehicle_part: item.vehicle_part || null,
      part_confidence: item.part_confidence ?? null,
      bbox: item.bbox,
    })),
    overall_severity: summary?.overall_severity || combined?.overall_severity || "None",
    fleet_status: summary?.fleet_status || "",
  };
}

export async function fetchAiInspectionSummary(context) {
  const response = await fetch(AI_INSPECTION_SUMMARY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(context),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string" ? data.detail : "AI summary request failed.",
    );
  }
  return data;
}
