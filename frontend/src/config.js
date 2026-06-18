// Backend API base URL — change this for staging/production deployments
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export const PREDICT_ENDPOINT = `${API_BASE_URL}/predict`;
export const PREDICT_MULTIVIEW_ENDPOINT = `${API_BASE_URL}/predict-multiview`;
export const FLEET_DASHBOARD_ENDPOINT = `${API_BASE_URL}/fleet/dashboard`;
export const FLEET_INSPECTIONS_ENDPOINT = `${API_BASE_URL}/fleet/inspections`;
export const AI_INSPECTION_SUMMARY_ENDPOINT = `${API_BASE_URL}/ai-inspection-summary`;
export const AI_INSPECTOR_STATUS_ENDPOINT = `${API_BASE_URL}/ai-inspector/status`;
export const PART_MODEL_STATUS_ENDPOINT = `${API_BASE_URL}/part-model/status`;

export function fleetInspectionDetailUrl(inspectionId) {
  return `${API_BASE_URL}/fleet/inspections/${inspectionId}`;
}

export function fleetInspectionPdfUrl(inspectionId) {
  return `${API_BASE_URL}/fleet/inspections/${inspectionId}/pdf`;
}
