import { useCallback, useEffect, useRef, useState } from "react";
import { PREDICT_ENDPOINT } from "./config";
import {
  capitalize,
  deriveInspectionReport,
  loadImageSize,
  severityBadgeClass,
  splitDetectionsByConfidence,
} from "./inspectionUtils";
import {
  DetectionCard,
  LocalizationBadge,
  PotentialDetectionsSection,
  PotentialFindingsReportSection,
} from "./PotentialFindingsSection";
import { PartLocalizationNote } from "./PartLocalizationNote";
import { VEHICLE_VIEW_OPTIONS, VEHICLE_VIEWS, AUTO_VIEW_WARNING } from "./vehiclePartUtils";
import MultiViewInspection from "./MultiViewInspection";
import FleetDashboard from "./FleetDashboard";
import InspectionHistory from "./InspectionHistory";
import RobotSimulator from "./RobotSimulator";
import AiInspectionAssistant from "./AiInspectionAssistant";
import { NoModelDetectedDamagePanel } from "./NoModelDetectedDamage";
import {
  buildSingleAiContext,
  fetchAiInspectionSummary,
} from "./aiInspectorUtils";
import { AI_INSPECTOR_STATUS_ENDPOINT, PART_MODEL_STATUS_ENDPOINT } from "./config";
import {
  DEMO_METRICS,
  FOOTER_TAGLINE,
  HERO_BADGES,
  PLATFORM_LABEL,
  PRODUCT_NAME,
  TAGLINE,
  WORKFLOW_STEPS,
} from "./brand";

/** Robot capture metadata — set programmatically when integrated with fleet robots. */
const ROBOT_CAPTURE_METADATA = null; // e.g. { view: "front" }

const INSPECTION_MODES = {
  SINGLE: "single",
  MULTIVIEW: "multiview",
};

const PAGES = {
  INSPECTION: "inspection",
  SIMULATOR: "simulator",
  DASHBOARD: "dashboard",
  HISTORY: "history",
};

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/bmp"];

function formatConfidence(confidence) {
  return `${(confidence * 100).toFixed(1)}%`;
}

function formatBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return "—";
  return `[${bbox.join(", ")}]`;
}

export default function App() {
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [vehicleView, setVehicleView] = useState(VEHICLE_VIEWS.FRONT);
  const [captureMetadata] = useState(ROBOT_CAPTURE_METADATA);
  const [inspectionMode, setInspectionMode] = useState(INSPECTION_MODES.SINGLE);
  const [showJson, setShowJson] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [currentPage, setCurrentPage] = useState(PAGES.INSPECTION);
  const [historyVehicleFilter, setHistoryVehicleFilter] = useState("");
  const [aiInspectorMode, setAiInspectorMode] = useState(false);
  const [aiInspection, setAiInspection] = useState(null);
  const [serverAiEnabled, setServerAiEnabled] = useState(false);
  const [partModelStatus, setPartModelStatus] = useState(null);

  useEffect(() => {
    fetch(AI_INSPECTOR_STATUS_ENDPOINT)
      .then((res) => res.json())
      .then((data) => setServerAiEnabled(Boolean(data.enabled)))
      .catch(() => setServerAiEnabled(false));
  }, []);

  useEffect(() => {
    fetch(PART_MODEL_STATUS_ENDPOINT)
      .then((res) => res.json())
      .then((data) => setPartModelStatus(data))
      .catch(() => setPartModelStatus(null));
  }, []);

  const resetPreview = useCallback((file) => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }, []);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    setError(null);
    setResult(null);
    setAiInspection(null);

    if (!file) {
      setSelectedFile(null);
      setImageSize({ width: 0, height: 0 });
      resetPreview(null);
      return;
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Please upload a valid image (JPEG, PNG, WebP, or BMP).");
      setSelectedFile(null);
      setImageSize({ width: 0, height: 0 });
      resetPreview(null);
      return;
    }

    setSelectedFile(file);
    resetPreview(file);
    const size = await loadImageSize(file);
    setImageSize(size);
  };

  const handleDetect = async () => {
    if (!selectedFile) {
      setError("Please select an image first.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setAiInspection(null);
    setShowJson(false);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("vehicle_id", vehicleId.trim());
    formData.append("view", vehicleView);
    if (aiInspectorMode) {
      formData.append("ai_inspector", "true");
    }

    try {
      const response = await fetch(PREDICT_ENDPOINT, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        const message =
          typeof data.detail === "string"
            ? data.detail
            : data.detail?.[0]?.msg || "Prediction request failed.";
        throw new Error(message);
      }

      setResult(data);

      if (aiInspectorMode) {
        const report = deriveInspectionReport(
          data.detections,
          imageSize,
          vehicleView,
          captureMetadata,
        );
        let aiData = data.ai_inspection;
        if (!aiData) {
          try {
            aiData = await fetchAiInspectionSummary(
              buildSingleAiContext({
                vehicleId,
                inspectionId: data.inspection_id,
                view: vehicleView,
                detections: data.detections,
                inspectionReport: report,
              }),
            );
          } catch {
            aiData = {
              enabled: true,
              source: "fallback",
              summary: report.damageSummary || "Rule-based inspection summary.",
              risk_assessment: report.suggestedAction || "",
              recommended_next_steps: report.recommendedNextCaptures?.length
                ? report.recommendedNextCaptures
                : [report.suggestedAction].filter(Boolean),
              fleet_decision:
                report.overallSeverity === "High"
                  ? "Do Not Deploy"
                  : report.overallSeverity === "Medium"
                    ? "Maintenance Review Recommended"
                    : "Safe to Operate",
            };
          }
        }
        setAiInspection(aiData);
      }
    } catch (err) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setSelectedFile(null);
    resetPreview(null);
    setResult(null);
    setImageSize({ width: 0, height: 0 });
    setVehicleView(VEHICLE_VIEWS.FRONT);
    setError(null);
    setShowJson(false);
    setAiInspection(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const detectionCount = result?.detections?.length ?? 0;
  const { confirmed: confirmedDetections, potential: potentialDetections } =
    splitDetectionsByConfidence(result?.detections);
  const inspectionReport = deriveInspectionReport(
    result?.detections,
    imageSize,
    vehicleView,
    captureMetadata,
  );

  return (
    <div className="page-shell">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-md shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-brand-600 text-sm font-bold text-white shadow-md shadow-cyan-600/25">
              AI
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                {PRODUCT_NAME}
              </h1>
              <p className="text-xs text-slate-500">{PLATFORM_LABEL}</p>
            </div>
          </div>
          <p className="hidden max-w-xs text-right text-xs leading-relaxed text-slate-500 lg:block">
            Edge-ready vehicle inspection for fleet operations
            {partModelStatus && (
              <>
                <br />
                Vehicle Part Model:{" "}
                {partModelStatus.enabled && partModelStatus.model_available
                  ? "Available"
                  : "Not Available, using rule-based fallback"}
              </>
            )}
          </p>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 pb-3 sm:px-6">
          {[
            { id: PAGES.INSPECTION, label: "Inspection" },
            { id: PAGES.SIMULATOR, label: "Robot Simulator" },
            { id: PAGES.DASHBOARD, label: "Fleet Dashboard" },
            { id: PAGES.HISTORY, label: "History" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrentPage(item.id)}
              className={`nav-tab shrink-0 ${
                currentPage === item.id ? "nav-tab-active" : "nav-tab-inactive"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {currentPage === PAGES.DASHBOARD && (
          <FleetDashboard onViewHistory={() => setCurrentPage(PAGES.HISTORY)} />
        )}

        {currentPage === PAGES.HISTORY && (
          <InspectionHistory
            key={historyVehicleFilter}
            initialVehicleId={historyVehicleFilter}
          />
        )}

        {currentPage === PAGES.SIMULATOR && (
          <RobotSimulator
            serverAiEnabled={serverAiEnabled}
            onViewDashboard={() => setCurrentPage(PAGES.DASHBOARD)}
            onViewHistory={(vehicleId) => {
              setHistoryVehicleFilter(vehicleId || "");
              setCurrentPage(PAGES.HISTORY);
            }}
          />
        )}

        {currentPage === PAGES.INSPECTION && (
        <>
        <section className="hero-gradient p-6 sm:p-10">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300/90">
              Autonomous Inspection Workflow
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              {PRODUCT_NAME}
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg">{TAGLINE}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {HERO_BADGES.map((badge) => (
                <span key={badge} className="feature-badge">
                  {badge}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {DEMO_METRICS.map((metric) => (
              <div key={metric.label} className="metric-card">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {metric.label}
                </p>
                <p className="mt-2 text-2xl font-bold text-white">{metric.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
              {WORKFLOW_STEPS.map((step, index) => (
                <div
                  key={step}
                  className="flex items-center gap-3 text-sm font-medium text-slate-200"
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-brand-600 text-xs font-bold text-white shadow-md">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                  {index < WORKFLOW_STEPS.length - 1 && (
                    <span className="hidden text-slate-500 md:inline">→</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="saas-card mt-8 p-2">
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={aiInspectorMode}
                onChange={(e) => setAiInspectorMode(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="font-medium">AI Inspector Mode</span>
              <span className="text-slate-400">
                {serverAiEnabled ? "(Ollama enabled on server)" : "(rule-based fallback)"}
              </span>
            </label>
            {partModelStatus && (
              <p className="text-xs text-slate-500 lg:hidden">
                Vehicle Part Model:{" "}
                <span className="font-medium text-slate-700">
                  {partModelStatus.enabled && partModelStatus.model_available
                    ? "Available"
                    : "Not Available, using rule-based fallback"}
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-slate-100 p-2">
            <button
              type="button"
              onClick={() => setInspectionMode(INSPECTION_MODES.SINGLE)}
              className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
                inspectionMode === INSPECTION_MODES.SINGLE
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Single Image Inspection
            </button>
            <button
              type="button"
              onClick={() => setInspectionMode(INSPECTION_MODES.MULTIVIEW)}
              className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
                inspectionMode === INSPECTION_MODES.MULTIVIEW
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Multi-View Inspection
            </button>
          </div>
        </section>

        {inspectionMode === INSPECTION_MODES.MULTIVIEW ? (
          <MultiViewInspection
            vehicleId={vehicleId}
            onVehicleIdChange={setVehicleId}
            aiInspectorMode={aiInspectorMode}
          />
        ) : (
          <>
        {/* Upload panel */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800">Vehicle & Upload</h2>
          <p className="mt-1 text-sm text-slate-500">
            Enter a fleet vehicle ID, then upload an image for damage detection.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="vehicle-id"
                className="block text-sm font-medium text-slate-700"
              >
                Vehicle ID
              </label>
              <input
                id="vehicle-id"
                type="text"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                disabled={loading}
                placeholder="e.g. EV-1042"
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
              />
            </div>
          </div>
        </section>

        <section className="saas-card mt-8 p-6">
          <h2 className="text-lg font-semibold text-slate-800">Upload Image</h2>
          <p className="mt-1 text-sm text-slate-500">
            Select a clear photo of the vehicle damage area and choose the capture
            view for part-aware reporting.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="vehicle-view"
                className="block text-sm font-medium text-slate-700"
              >
                Vehicle View
              </label>
              <select
                id="vehicle-view"
                value={vehicleView}
                onChange={(e) => setVehicleView(e.target.value)}
                disabled={loading}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
              >
                {VEHICLE_VIEW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-slate-400">
                Select the capture angle for accurate part mapping. Auto is optional
                and uses conservative heuristics only.
              </p>
              {vehicleView === VEHICLE_VIEWS.AUTO && (
                <div
                  role="note"
                  className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                >
                  {AUTO_VIEW_WARNING}
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center">
            <label className="upload-dropzone flex-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/bmp"
                onChange={handleFileChange}
                className="hidden"
              />
              <svg
                className="mb-3 h-10 w-10 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
              <span className="text-sm font-medium text-slate-700">
                {selectedFile ? selectedFile.name : "Click to choose an image"}
              </span>
              <span className="mt-1 text-xs text-slate-400">
                JPEG, PNG, WebP, BMP
              </span>
            </label>

            <div className="flex flex-col gap-3 sm:w-48">
              <button
                type="button"
                onClick={handleDetect}
                disabled={!selectedFile || loading}
                className="btn-primary w-full sm:w-auto"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Detecting…
                  </>
                ) : (
                  "Detect Damage"
                )}
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={loading}
                className="btn-secondary w-full sm:w-auto"
              >
                Clear
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          )}
        </section>

        {/* Image previews */}
        {(previewUrl || result?.annotated_image_url) && (
          <section className="mt-8 grid gap-6 md:grid-cols-2">
            {previewUrl && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Uploaded Image
                </h3>
                <div className="overflow-hidden rounded-xl bg-slate-100">
                  <img
                    src={previewUrl}
                    alt="Uploaded vehicle"
                    className="h-auto max-h-96 w-full object-contain"
                  />
                </div>
              </div>
            )}

            {result?.annotated_image_url && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Annotated Output
                </h3>
                <div className="overflow-hidden rounded-xl bg-slate-100">
                  <img
                    src={result.annotated_image_url}
                    alt="Annotated damage detection"
                    className="h-auto max-h-96 w-full object-contain"
                  />
                </div>
              </div>
            )}
          </section>
        )}

        {/* Detection results */}
        {result && (
          <section className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">
                Detection Results
              </h2>
              <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700">
                {detectionCount} detection{detectionCount !== 1 ? "s" : ""}
              </span>
            </div>

            {detectionCount === 0 ? (
              <NoModelDetectedDamagePanel />
            ) : (
              <>
                {confirmedDetections.length > 0 && (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {confirmedDetections.map((det, index) => (
                      <DetectionCard
                        key={`confirmed-${det.damage_type}-${index}`}
                        det={det}
                        index={index}
                        formatConfidence={formatConfidence}
                        formatBbox={formatBbox}
                        variant="confirmed"
                      />
                    ))}
                  </div>
                )}
                <PotentialDetectionsSection
                  detections={potentialDetections}
                  formatConfidence={formatConfidence}
                  formatBbox={formatBbox}
                />
              </>
            )}

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">
                    Inspection Report
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Part-aware vehicle inspection findings from all model detections.
                    {inspectionReport.resolvedViewLabel && (
                      <span className="ml-1 text-brand-600">
                        View context: {inspectionReport.resolvedViewLabel}
                        {inspectionReport.captureContext?.source === "metadata" &&
                          " (robot metadata)"}
                      </span>
                    )}
                  </p>
                  <PartLocalizationNote />
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${severityBadgeClass(
                    inspectionReport.overallSeverity,
                  )}`}
                >
                  {inspectionReport.overallSeverity} Severity
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Confirmed Findings
                  </p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">
                    {inspectionReport.totalDamagesDetected}
                  </p>
                  {inspectionReport.potentialFindingsCount > 0 && (
                    <p className="mt-1 text-xs text-amber-700">
                      +{inspectionReport.potentialFindingsCount} potential (verification
                      required)
                    </p>
                  )}
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Overall Severity
                  </p>
                  <p className="mt-2 text-base font-semibold text-slate-900">
                    {inspectionReport.overallSeverity}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Fleet Status
                  </p>
                  <p className="mt-2 text-base font-semibold text-slate-900">
                    {inspectionReport.fleetInspectionStatus}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Fleet Action
                  </p>
                  <p className="mt-2 text-sm text-slate-700">
                    {inspectionReport.suggestedAction}
                  </p>
                </div>
              </div>

              {inspectionReport.showAutoWarning && (
                <div
                  role="note"
                  className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                >
                  {inspectionReport.autoViewWarning}
                </div>
              )}

              {inspectionReport.isUnknownView && inspectionReport.viewSelectionRecommendation && (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                >
                  {inspectionReport.viewSelectionRecommendation}
                </div>
              )}

              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Damage Summary
                </p>
                <p className="mt-2 text-sm text-slate-700">
                  {inspectionReport.damageSummary}
                </p>
              </div>

              {inspectionReport.broadDetectionWarning && (
                <>
                  <div
                    role="alert"
                    className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                  >
                    {inspectionReport.broadMaskMessage}
                  </div>

                  {inspectionReport.possibleAdditionalDamagedAreas.length > 0 && (
                    <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/50 p-4">
                      <h3 className="text-sm font-semibold text-amber-900">
                        Possible Additional Damaged Areas
                      </h3>
                      <p className="mt-1 text-xs text-amber-700">
                        Broad mask detected — these regions may also require inspection.
                      </p>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {inspectionReport.possibleAdditionalDamagedAreas.map((area) => (
                          <li
                            key={area}
                            className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-900"
                          >
                            {area}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {inspectionReport.recommendedNextCaptures.length > 0 && (
                <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                  <h3 className="text-sm font-semibold text-brand-900">
                    Recommended Next Captures
                  </h3>
                  <p className="mt-1 text-xs text-brand-700">
                    {inspectionReport.isUnknownView
                      ? "Improve part-level accuracy by confirming the vehicle view or capturing additional angles."
                      : "Follow-up images for part-level confirmation by the inspection robot."}
                  </p>
                  <ul className="mt-3 space-y-2">
                    {inspectionReport.recommendedNextCaptures.map((capture) => (
                      <li
                        key={capture}
                        className="flex items-start gap-2 text-sm text-brand-900"
                      >
                        <span className="mt-0.5 text-brand-500" aria-hidden="true">
                          →
                        </span>
                        <span>{capture}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {inspectionReport.findings.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Confirmed Findings
                  </h3>
                  <div className="space-y-4">
                    {inspectionReport.findings.map((finding) => (
                      <article
                        key={`finding-${finding.id}-${finding.damageType}`}
                        className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                              Finding {finding.id}
                            </p>
                            <h4 className="mt-1 text-lg font-semibold text-slate-900">
                              {finding.damageType}
                            </h4>
                            <p className="mt-1 text-sm text-slate-600">
                              {finding.likelyVehiclePart}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            {finding.localizationMethod && (
                              <LocalizationBadge method={finding.localizationMethod} />
                            )}
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${severityBadgeClass(
                                finding.severity,
                              )}`}
                            >
                              {finding.severity} Severity
                            </span>
                          </div>
                        </div>

                        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                          <div className="flex justify-between gap-4 sm:block">
                            <dt className="text-slate-500">Likely Vehicle Part</dt>
                            <dd className="font-medium text-slate-800">
                              {finding.likelyVehiclePart}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-4 sm:block">
                            <dt className="text-slate-500">Confidence</dt>
                            <dd className="font-medium text-slate-800">
                              {formatConfidence(finding.confidence)}
                            </dd>
                          </div>
                          {finding.partConfidence != null && (
                            <div className="flex justify-between gap-4 sm:block">
                              <dt className="text-slate-500">Part Confidence</dt>
                              <dd className="font-medium text-slate-800">
                                {formatConfidence(finding.partConfidence)}
                              </dd>
                            </div>
                          )}
                          <div className="flex justify-between gap-4 sm:block">
                            <dt className="text-slate-500">Severity</dt>
                            <dd className="font-medium text-slate-800">{finding.severity}</dd>
                          </div>
                          <div className="flex justify-between gap-4 sm:block">
                            <dt className="text-slate-500">Mask Available</dt>
                            <dd className="font-medium text-slate-800">
                              {finding.hasMask ? "Yes" : "No"}
                            </dd>
                          </div>
                          <div className="sm:col-span-2">
                            <dt className="text-slate-500">Bounding Box</dt>
                            <dd className="mt-1 font-mono text-xs text-slate-700">
                              {formatBbox(finding.bbox)}
                            </dd>
                          </div>
                          <div className="sm:col-span-2">
                            <dt className="text-slate-500">Suggested Action</dt>
                            <dd className="mt-1 text-slate-700">
                              {finding.suggestedAction}
                            </dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              <PotentialFindingsReportSection
                findings={inspectionReport.potentialFindings}
                formatConfidence={formatConfidence}
                formatBbox={formatBbox}
              />
            </div>

            <AiInspectionAssistant aiInspection={aiInspection} />

            {/* Raw JSON */}
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setShowJson((v) => !v)}
                className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <span>Raw JSON Response</span>
                <svg
                  className={`h-5 w-5 text-slate-400 transition ${showJson ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {showJson && (
                <pre className="overflow-x-auto border-t border-slate-100 bg-slate-900 p-5 text-xs leading-relaxed text-emerald-300">
                  {JSON.stringify(result, null, 2)}
                </pre>
              )}
            </div>
          </section>
        )}
          </>
        )}
        </>
        )}
      </main>

      <footer className="mt-12 border-t border-slate-200/80 bg-white/60 py-8 text-center">
        <p className="text-sm font-medium text-slate-700">{PRODUCT_NAME}</p>
        <p className="mt-1 text-xs text-slate-500">{FOOTER_TAGLINE}</p>
      </footer>
    </div>
  );
}
