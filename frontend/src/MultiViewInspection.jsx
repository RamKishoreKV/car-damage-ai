import { useCallback, useId, useState } from "react";
import { PREDICT_MULTIVIEW_ENDPOINT } from "./config";
import { capitalize, severityBadgeClass, splitDetectionsByConfidence } from "./inspectionUtils";
import {
  CombinedReportItem,
  DetectionCard,
  PotentialDetectionsSection,
} from "./PotentialFindingsSection";
import AiInspectionAssistant from "./AiInspectionAssistant";
import { NoModelDetectedDamagePanel } from "./NoModelDetectedDamage";
import { PartLocalizationNote } from "./PartLocalizationNote";
import { POTENTIAL_FINDINGS_TITLE } from "./vehiclePartUtils";
import {
  buildMultiviewAiContext,
  fetchAiInspectionSummary,
} from "./aiInspectorUtils";

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/bmp",
];

export const MULTIVIEW_SLOT_OPTIONS = [
  { value: "front", label: "Front" },
  { value: "rear", label: "Rear" },
  { value: "left_side", label: "Left Side" },
  { value: "right_side", label: "Right Side" },
  { value: "wheel_closeup", label: "Wheel / Tire Close-up" },
  { value: "damage_closeup", label: "Damage Close-up" },
  { value: "unknown", label: "Unknown" },
];

const DEFAULT_SLOTS = [
  { view: "front" },
  { view: "rear" },
  { view: "left_side" },
  { view: "right_side" },
];

function createSlot(view) {
  return {
    id: crypto.randomUUID(),
    view,
    file: null,
    previewUrl: null,
  };
}

function formatConfidence(confidence) {
  return `${(confidence * 100).toFixed(1)}%`;
}

function formatBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return "—";
  return `[${bbox.join(", ")}]`;
}

function viewLabel(view) {
  return MULTIVIEW_SLOT_OPTIONS.find((o) => o.value === view)?.label ?? view;
}

export default function MultiViewInspection({
  vehicleId = "",
  onVehicleIdChange,
  aiInspectorMode = false,
}) {
  const baseId = useId();
  const [slots, setSlots] = useState(() => DEFAULT_SLOTS.map((s) => createSlot(s.view)));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [aiInspection, setAiInspection] = useState(null);
  const [showJson, setShowJson] = useState(false);

  const activeSlots = slots.filter((slot) => slot.file);

  const revokePreview = useCallback((url) => {
    if (url) URL.revokeObjectURL(url);
  }, []);

  const updateSlot = (id, patch) => {
    setSlots((prev) =>
      prev.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
    );
  };

  const handleSlotFileChange = (id, event) => {
    const file = event.target.files?.[0];
    setError(null);
    setResult(null);
    setAiInspection(null);

    const slot = slots.find((s) => s.id === id);
    if (slot?.previewUrl) revokePreview(slot.previewUrl);

    if (!file) {
      updateSlot(id, { file: null, previewUrl: null });
      return;
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Please upload valid images (JPEG, PNG, WebP, or BMP).");
      updateSlot(id, { file: null, previewUrl: null });
      return;
    }

    updateSlot(id, {
      file,
      previewUrl: URL.createObjectURL(file),
    });
  };

  const handleRemoveSlot = (id) => {
    const slot = slots.find((s) => s.id === id);
    if (slot?.previewUrl) revokePreview(slot.previewUrl);
    setSlots((prev) => prev.filter((s) => s.id !== id));
    setResult(null);
    setAiInspection(null);
  };

  const handleAddCloseupSlot = () => {
    setSlots((prev) => [...prev, createSlot("wheel_closeup")]);
  };

  const handleClear = () => {
    slots.forEach((slot) => revokePreview(slot.previewUrl));
    setSlots(DEFAULT_SLOTS.map((s) => createSlot(s.view)));
    setResult(null);
    setAiInspection(null);
    setError(null);
    setShowJson(false);
  };

  const handleRunInspection = async () => {
    if (activeSlots.length === 0) {
      setError("Add at least one image before running multi-view inspection.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setAiInspection(null);
    setShowJson(false);

    const formData = new FormData();
    activeSlots.forEach((slot) => {
      formData.append("files", slot.file);
      formData.append("views", slot.view);
    });
    formData.append("vehicle_id", vehicleId.trim());
    if (aiInspectorMode) {
      formData.append("ai_inspector", "true");
    }

    try {
      const response = await fetch(PREDICT_MULTIVIEW_ENDPOINT, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        const message =
          typeof data.detail === "string"
            ? data.detail
            : data.detail?.[0]?.msg || "Multi-view inspection request failed.";
        throw new Error(message);
      }

      setResult(data);

      if (aiInspectorMode) {
        let aiData = data.ai_inspection;
        if (!aiData) {
          try {
            aiData = await fetchAiInspectionSummary(
              buildMultiviewAiContext({ vehicleId, result: data }),
            );
          } catch {
            const summary = data.vehicle_level_summary;
            const combined = data.combined_report;
            aiData = {
              enabled: true,
              source: "fallback",
              summary: combined?.summary || "Rule-based multi-view inspection summary.",
              risk_assessment: combined?.suggested_action || "",
              recommended_next_steps: [combined?.suggested_action].filter(Boolean),
              fleet_decision:
                summary?.overall_severity === "High"
                  ? "Do Not Deploy"
                  : summary?.overall_severity === "Medium"
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

  const summary = result?.vehicle_level_summary;
  const combined = result?.combined_report;

  return (
    <>
      <section className="saas-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              Multi-View Vehicle Inspection
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Upload images from multiple angles — front, rear, sides, and optional
              close-ups — to generate one combined vehicle-level inspection report.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAddCloseupSlot}
            disabled={loading}
            className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-100 disabled:opacity-50"
          >
            + Add Wheel / Close-up Image
          </button>
        </div>

        <div className="mt-5 max-w-md">
          <label
            htmlFor="multiview-vehicle-id"
            className="block text-sm font-medium text-slate-700"
          >
            Vehicle ID
          </label>
          <input
            id="multiview-vehicle-id"
            type="text"
            value={vehicleId}
            onChange={(e) => onVehicleIdChange?.(e.target.value)}
            disabled={loading}
            placeholder="e.g. EV-1042"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
          />
        </div>

        <div className="mt-6 space-y-4">
          {slots.map((slot, index) => (
            <article
              key={slot.id}
              className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <div className="min-w-[180px] lg:w-48">
                  <label
                    htmlFor={`${baseId}-view-${slot.id}`}
                    className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    View {index + 1}
                  </label>
                  <select
                    id={`${baseId}-view-${slot.id}`}
                    value={slot.view}
                    onChange={(e) => updateSlot(slot.id, { view: e.target.value })}
                    disabled={loading}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
                  >
                    {MULTIVIEW_SLOT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                  <label className="flex flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-6 transition hover:border-brand-500 hover:bg-brand-50/40">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/bmp"
                      onChange={(e) => handleSlotFileChange(slot.id, e)}
                      disabled={loading}
                      className="hidden"
                    />
                    <span className="text-sm font-medium text-slate-700">
                      {slot.file ? slot.file.name : "Choose image"}
                    </span>
                    <span className="mt-1 text-xs text-slate-400">
                      JPEG, PNG, WebP, BMP
                    </span>
                  </label>

                  {slot.previewUrl && (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white sm:w-40">
                      <img
                        src={slot.previewUrl}
                        alt={`${viewLabel(slot.view)} preview`}
                        className="h-28 w-full object-cover"
                      />
                    </div>
                  )}
                </div>

                {slots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveSlot(slot.id)}
                    disabled={loading}
                    className="self-start rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleRunInspection}
            disabled={loading || activeSlots.length === 0}
            className="btn-primary"
          >
            {loading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Inspecting…
              </>
            ) : (
              "Run Multi-View Inspection"
            )}
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={loading}
            className="btn-secondary"
          >
            Clear All
          </button>
          <span className="self-center text-sm text-slate-500">
            {activeSlots.length} of {slots.length} slots ready
          </span>
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

      {result && (
        <section className="mt-8 space-y-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">
                  Vehicle-Level Summary
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Inspection ID:{" "}
                  <span className="font-mono text-xs text-slate-600">
                    {result.inspection_id}
                  </span>
                </p>
              </div>
              {summary?.overall_severity && (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${severityBadgeClass(
                    summary.overall_severity,
                  )}`}
                >
                  {summary.overall_severity} Severity
                </span>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Images Inspected
                </p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {summary?.total_images ?? 0}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Total Damages
                </p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {summary?.total_damages ?? 0}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Views Inspected
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {(summary?.views_inspected ?? [])
                    .map(viewLabel)
                    .join(", ") || "—"}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Fleet Status
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {summary?.fleet_status ?? "—"}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4 sm:col-span-2 xl:col-span-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Suggested Action
                </p>
                <p className="mt-2 text-sm text-slate-700">
                  {combined?.suggested_action ?? "—"}
                </p>
              </div>
            </div>

            {combined?.summary && (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Combined Report Summary
                </p>
                <p className="mt-2 text-sm text-slate-700">{combined.summary}</p>
              </div>
            )}
          </div>

          {result.views?.map((viewResult) => (
            <div
              key={`${viewResult.view}-${viewResult.filename}`}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">
                    {viewLabel(viewResult.view)} View
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">{viewResult.view_summary}</p>
                </div>
                <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700">
                  {viewResult.detections?.length ?? 0} detection
                  {(viewResult.detections?.length ?? 0) !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                {viewResult.annotated_image_url && (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                    <img
                      src={viewResult.annotated_image_url}
                      alt={`${viewLabel(viewResult.view)} annotated`}
                      className="h-auto max-h-96 w-full object-contain"
                    />
                  </div>
                )}

                <div>
                  {(viewResult.detections?.length ?? 0) === 0 ? (
                    <NoModelDetectedDamagePanel compact />
                  ) : (
                    (() => {
                      const { confirmed, potential } = splitDetectionsByConfidence(
                        viewResult.detections,
                      );
                      return (
                        <>
                          {confirmed.length > 0 && (
                            <div className="grid gap-3">
                              {confirmed.map((det, index) => (
                                <DetectionCard
                                  key={`${viewResult.view}-confirmed-${index}`}
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
                            detections={potential}
                            formatConfidence={formatConfidence}
                            formatBbox={formatBbox}
                          />
                        </>
                      );
                    })()
                  )}
                </div>
              </div>
            </div>
          ))}

          {combined?.items?.length > 0 && (
            <div className="saas-card-elevated p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">
                    Combined Inspection Report
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Professional service report — findings grouped by vehicle view.
                  </p>
                </div>
                {summary?.overall_severity && (
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${severityBadgeClass(
                      summary.overall_severity,
                    )}`}
                  >
                    {summary.overall_severity} Severity
                  </span>
                )}
              </div>
              {combined.summary && (
                <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Summary
                  </p>
                  <p className="mt-2 text-sm text-slate-700">{combined.summary}</p>
                  {combined.suggested_action && (
                    <p className="mt-2 text-sm text-slate-600">
                      <span className="font-medium">Suggested action:</span>{" "}
                      {combined.suggested_action}
                    </p>
                  )}
                </div>
              )}
              <PartLocalizationNote />
              {[...new Set(combined.items.filter((i) => !i.verification_required).map((i) => i.view))].map(
                (viewKey) => (
                  <div key={`view-group-${viewKey}`} className="mt-6">
                    <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-cyan-700">
                      {viewLabel(viewKey)} View
                    </h4>
                    <div className="space-y-3">
                      {combined.items
                        .filter((item) => !item.verification_required && item.view === viewKey)
                        .map((item, index) => (
                          <CombinedReportItem
                            key={`confirmed-${viewKey}-${item.damage_type}-${index}`}
                            item={item}
                            index={index}
                            viewLabel={viewLabel}
                            formatConfidence={formatConfidence}
                          />
                        ))}
                    </div>
                  </div>
                ),
              )}
              {combined.items.some((item) => item.verification_required) && (
                <div className="mt-6">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-amber-700">
                    {POTENTIAL_FINDINGS_TITLE}
                  </h4>
                  <p className="mt-1 text-sm text-amber-800/80">
                    Confidence below 40% — verification required before escalating severity.
                  </p>
                  <div className="mt-4 space-y-3">
                    {combined.items
                      .filter((item) => item.verification_required)
                      .map((item, index) => (
                        <CombinedReportItem
                          key={`potential-${item.view}-${item.damage_type}-${index}`}
                          item={item}
                          index={index}
                          viewLabel={viewLabel}
                          formatConfidence={formatConfidence}
                        />
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <AiInspectionAssistant aiInspection={aiInspection} />

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
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
  );
}
