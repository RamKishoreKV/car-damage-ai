import { useCallback, useEffect, useRef, useState } from "react";
import {
  fleetInspectionPdfUrl,
  PREDICT_MULTIVIEW_ENDPOINT,
} from "./config";
import { capitalize, severityBadgeClass, splitDetectionsByConfidence } from "./inspectionUtils";
import {
  buildMultiviewAiContext,
  fetchAiInspectionSummary,
} from "./aiInspectorUtils";
import AiInspectionAssistant from "./AiInspectionAssistant";
import {
  CombinedReportItem,
  DetectionCard,
  PotentialDetectionsSection,
} from "./PotentialFindingsSection";
import RobotMissionMap from "./RobotMissionMap";
import { POTENTIAL_FINDINGS_TITLE } from "./vehiclePartUtils";
import {
  CAMERA_SLOTS,
  CAPTURE_SEQUENCE,
  isStepActive,
  isStepComplete,
  MISSION_STATES,
  missionProgressPercent,
  randomDelayMs,
  STATE_ORDER,
  TIMELINE_STEPS,
} from "./robotMissionConstants";

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/bmp",
];

function formatConfidence(confidence) {
  return `${(confidence * 100).toFixed(1)}%`;
}

function formatBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return "—";
  return `[${bbox.join(", ")}]`;
}

function viewLabel(view) {
  return capitalize(view || "unknown");
}

function createInitialSlots() {
  return CAMERA_SLOTS.map((slot) => ({
    ...slot,
    file: null,
    previewUrl: null,
  }));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function RobotSimulator({
  serverAiEnabled = false,
  onViewDashboard,
  onViewHistory,
}) {
  const [vehicleId, setVehicleId] = useState("");
  const [missionName, setMissionName] = useState("");
  const [aiInspectorMode, setAiInspectorMode] = useState(false);
  const [slots, setSlots] = useState(createInitialSlots);
  const [missionState, setMissionState] = useState(MISSION_STATES.IDLE);
  const [capturedViews, setCapturedViews] = useState([]);
  const [imagesCaptured, setImagesCaptured] = useState(0);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [result, setResult] = useState(null);
  const [aiInspection, setAiInspection] = useState(null);
  const [showJson, setShowJson] = useState(false);
  const [missionRunning, setMissionRunning] = useState(false);

  const cancelRef = useRef(false);
  const previewUrlsRef = useRef([]);

  const revokePreviews = useCallback(() => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = [];
  }, []);

  useEffect(() => () => revokePreviews(), [revokePreviews]);

  const handleSlotFileChange = (slotKey, event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Please upload a JPEG, PNG, WebP, or BMP image.");
      return;
    }

    setError(null);
    setResult(null);
    setAiInspection(null);

    const previewUrl = URL.createObjectURL(file);
    previewUrlsRef.current.push(previewUrl);

    setSlots((prev) =>
      prev.map((slot) =>
        slot.key === slotKey ? { ...slot, file, previewUrl } : slot,
      ),
    );
  };

  const handleClearSlots = () => {
    if (missionRunning) return;
    revokePreviews();
    setSlots(createInitialSlots());
    setResult(null);
    setAiInspection(null);
    setError(null);
    setWarning(null);
    setCapturedViews([]);
    setImagesCaptured(0);
    setMissionState(MISSION_STATES.IDLE);
  };

  const validateMission = () => {
    const missing = slots.filter((slot) => !slot.file).map((slot) => slot.label);
    if (missing.length > 0) {
      return `Missing required camera image(s): ${missing.join(", ")}.`;
    }
    if (!vehicleId.trim()) {
      return "Vehicle ID is required for fleet dashboard tracking.";
    }
    return null;
  };

  const runMultiviewInspection = async () => {
    const formData = new FormData();
    CAPTURE_SEQUENCE.forEach((view) => {
      const slot = slots.find((s) => s.view === view);
      if (slot?.file) {
        formData.append("files", slot.file);
        formData.append("views", slot.view);
      }
    });
    formData.append("vehicle_id", vehicleId.trim());
    formData.append("robot_mode", "true");
    formData.append("mission_name", missionName.trim());
    formData.append("capture_sequence", JSON.stringify(CAPTURE_SEQUENCE));
    if (aiInspectorMode) {
      formData.append("ai_inspector", "true");
    }

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

    let aiData = data.ai_inspection;
    if (aiInspectorMode && !aiData) {
      try {
        aiData = await fetchAiInspectionSummary(
          buildMultiviewAiContext({ vehicleId, result: data }),
        );
      } catch {
        setWarning(
          "AI Inspector unavailable — showing rule-based inspection summary instead.",
        );
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

    return { data, aiData };
  };

  const advanceSimulatedStates = async () => {
    const simulatedStates = [
      MISSION_STATES.MOVING_TO_VEHICLE,
      MISSION_STATES.CAPTURING_FRONT,
      MISSION_STATES.CAPTURING_LEFT,
      MISSION_STATES.CAPTURING_RIGHT,
      MISSION_STATES.CAPTURING_REAR,
    ];

    const captureByState = {
      [MISSION_STATES.CAPTURING_FRONT]: "front",
      [MISSION_STATES.CAPTURING_LEFT]: "left_side",
      [MISSION_STATES.CAPTURING_RIGHT]: "right_side",
      [MISSION_STATES.CAPTURING_REAR]: "rear",
    };

    for (const state of simulatedStates) {
      if (cancelRef.current) {
        setMissionState(MISSION_STATES.CANCELLED);
        return false;
      }

      setMissionState(state);

      if (captureByState[state]) {
        await delay(randomDelayMs());
        if (cancelRef.current) {
          setMissionState(MISSION_STATES.CANCELLED);
          return false;
        }
        const view = captureByState[state];
        setCapturedViews((prev) => [...prev, view]);
        setImagesCaptured((count) => count + 1);
      } else {
        await delay(randomDelayMs());
      }
    }

    return true;
  };

  const handleStartMission = async () => {
    const validationError = validateMission();
    if (validationError) {
      setError(validationError);
      return;
    }

    cancelRef.current = false;
    setMissionRunning(true);
    setError(null);
    setWarning(null);
    setResult(null);
    setAiInspection(null);
    setCapturedViews([]);
    setImagesCaptured(0);
    setShowJson(false);
    setMissionState(MISSION_STATES.MOVING_TO_VEHICLE);

    try {
      const continued = await advanceSimulatedStates();
      if (!continued) {
        setMissionRunning(false);
        return;
      }

      setMissionState(MISSION_STATES.RUNNING_AI_INSPECTION);
      const { data, aiData } = await runMultiviewInspection();

      if (cancelRef.current) {
        setMissionState(MISSION_STATES.CANCELLED);
        setMissionRunning(false);
        return;
      }

      setResult(data);
      setAiInspection(aiData || null);

      setMissionState(MISSION_STATES.SAVING_TO_FLEET_DASHBOARD);
      await delay(randomDelayMs());

      if (cancelRef.current) {
        setMissionState(MISSION_STATES.CANCELLED);
        setMissionRunning(false);
        return;
      }

      setMissionState(MISSION_STATES.COMPLETE);
    } catch (err) {
      setMissionState(MISSION_STATES.ERROR);
      setError(err.message || "Robot inspection mission failed.");
    } finally {
      setMissionRunning(false);
    }
  };

  const handleCancelMission = () => {
    cancelRef.current = true;
    setMissionRunning(false);
    if (missionState !== MISSION_STATES.COMPLETE) {
      setMissionState(MISSION_STATES.CANCELLED);
    }
  };

  const progress = missionProgressPercent(missionState);
  const summary = result?.vehicle_level_summary;
  const combined = result?.combined_report;
  const inspectionResultLabel =
    missionState === MISSION_STATES.COMPLETE
      ? summary?.overall_severity
        ? `${summary.overall_severity} — ${summary.fleet_status || "Saved"}`
        : "Mission complete"
      : missionState === MISSION_STATES.ERROR
        ? "Failed"
        : missionState === MISSION_STATES.CANCELLED
          ? "Cancelled"
          : "Pending";

  return (
    <div className="space-y-8">
      <section className="hero-gradient p-6 sm:p-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300/90">
            Autonomous Inspection Workflow
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Robot Simulator
          </h2>
          <p className="mt-3 text-base leading-7 text-slate-300">
            Simulated capture sequence for multi-view fleet inspection. The workflow
            moves around a vehicle, captures front, side, and rear images, runs the
            local YOLO pipeline, and saves results to the fleet dashboard.
          </p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Vehicle ID</span>
            <input
              type="text"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              disabled={missionRunning}
              placeholder="e.g. EV-1042"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-50"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Mission Name</span>
            <input
              type="text"
              value={missionName}
              onChange={(e) => setMissionName(e.target.value)}
              disabled={missionRunning}
              placeholder="e.g. Bay 3 Morning Patrol"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-50"
            />
          </label>
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <input
                type="checkbox"
                checked={aiInspectorMode}
                onChange={(e) => setAiInspectorMode(e.target.checked)}
                disabled={missionRunning || !serverAiEnabled}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  AI Inspector Mode
                </span>
                <span className="block text-xs text-slate-500">
                  {serverAiEnabled
                    ? "Natural-language fleet summary after inspection"
                    : "Enable Ollama on the backend to use AI summaries"}
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {slots.map((slot) => (
            <article
              key={slot.key}
              className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4"
            >
              <h3 className="text-sm font-semibold text-slate-800">{slot.label}</h3>
              <p className="mt-1 text-xs text-slate-500">View: {slot.view}</p>
              <label className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-3 py-6 text-center transition hover:border-brand-400 hover:bg-brand-50/30">
                <input
                  type="file"
                  accept={ACCEPTED_TYPES.join(",")}
                  className="hidden"
                  disabled={missionRunning}
                  onChange={(e) => handleSlotFileChange(slot.key, e)}
                />
                {slot.previewUrl ? (
                  <img
                    src={slot.previewUrl}
                    alt={`${slot.label} preview`}
                    className="h-28 w-full rounded-lg object-cover"
                  />
                ) : (
                  <>
                    <span className="text-2xl text-slate-300">📷</span>
                    <span className="mt-2 text-xs font-medium text-slate-600">
                      Upload image
                    </span>
                  </>
                )}
              </label>
            </article>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleStartMission}
            disabled={missionRunning}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {missionRunning ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Mission in progress…
              </>
            ) : (
              "Start Robot Inspection Mission"
            )}
          </button>
          <button
            type="button"
            onClick={handleCancelMission}
            disabled={!missionRunning}
            className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel Mission
          </button>
          <button
            type="button"
            onClick={handleClearSlots}
            disabled={missionRunning}
            className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Clear All
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}
        {warning && (
          <div
            role="note"
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            {warning}
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-1">
          <h3 className="text-lg font-semibold text-slate-800">Mission Status</h3>
          <dl className="mt-4 space-y-4 text-sm">
            <div>
              <dt className="text-slate-500">Current State</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-brand-700">
                {missionState}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Mission Progress</dt>
              <dd className="mt-2">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs font-medium text-slate-600">{progress}%</p>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Vehicle ID</dt>
              <dd className="mt-1 font-medium text-slate-800">
                {vehicleId.trim() || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Images Captured</dt>
              <dd className="mt-1 font-medium text-slate-800">
                {imagesCaptured} / {CAMERA_SLOTS.length}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Inspection Result</dt>
              <dd className="mt-1 font-medium text-slate-800">{inspectionResultLabel}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-1">
          <h3 className="text-lg font-semibold text-slate-800">Mission Timeline</h3>
          <ol className="mt-4 space-y-3">
            {TIMELINE_STEPS.map((step) => {
              const complete = isStepComplete(step, missionState);
              const active = isStepActive(step, missionState);
              return (
                <li
                  key={step.id}
                  className={`flex items-start gap-3 rounded-xl px-3 py-2 text-sm transition ${
                    active ? "bg-brand-50 text-brand-900" : "text-slate-700"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      complete
                        ? "bg-emerald-500 text-white"
                        : active
                          ? "bg-brand-500 text-white animate-pulse"
                          : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {complete ? "✓" : active ? "…" : ""}
                  </span>
                  <span className={complete ? "font-medium" : ""}>{step.label}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="xl:col-span-1">
          <RobotMissionMap
            currentState={missionState}
            capturedViews={capturedViews}
          />
        </div>
      </div>

      {result && (
        <section className="space-y-8">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-emerald-900">
                  Mission Complete — Inspection Saved
                </h3>
                <p className="mt-1 text-sm text-emerald-800">
                  Inspection ID:{" "}
                  <span className="font-mono text-xs">{result.inspection_id}</span>
                </p>
                {result.robot_mission?.mission_name && (
                  <p className="mt-1 text-sm text-emerald-800">
                    Mission: {result.robot_mission.mission_name}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onViewDashboard?.()}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Fleet Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => onViewHistory?.(vehicleId.trim())}
                  className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
                >
                  Search History
                </button>
                {result.inspection_id && (
                  <a
                    href={fleetInspectionPdfUrl(result.inspection_id)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Export PDF
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">
                  Vehicle-Level Summary
                </h2>
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
              {[
                ["Images Inspected", summary?.total_images ?? 0],
                ["Total Damages", summary?.total_damages ?? 0],
                [
                  "Views Inspected",
                  (summary?.views_inspected ?? []).map(viewLabel).join(", ") || "—",
                ],
                ["Fleet Status", summary?.fleet_status ?? "—"],
                ["Suggested Action", combined?.suggested_action ?? "—"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {label}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
                </div>
              ))}
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
                  {(() => {
                    const { confirmed, potential } = splitDetectionsByConfidence(
                      viewResult.detections,
                    );
                    if (confirmed.length === 0 && potential.length === 0) {
                      return (
                        <div className="rounded-xl border border-slate-100 bg-slate-50 p-6 text-center text-sm text-slate-600">
                          No damage detected on this view.
                        </div>
                      );
                    }
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
                  })()}
                </div>
              </div>
            </div>
          ))}

          {combined?.items?.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-800">
                Combined Inspection Report
              </h3>
              <div className="mt-4 space-y-3">
                {combined.items
                  .filter((item) => !item.verification_required)
                  .map((item, index) => (
                    <CombinedReportItem
                      key={`confirmed-${item.view}-${index}`}
                      item={item}
                      index={index}
                      viewLabel={viewLabel}
                      formatConfidence={formatConfidence}
                    />
                  ))}
              </div>
              {combined.items.some((item) => item.verification_required) && (
                <div className="mt-6">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-amber-700">
                    {POTENTIAL_FINDINGS_TITLE}
                  </h4>
                  <div className="mt-4 space-y-3">
                    {combined.items
                      .filter((item) => item.verification_required)
                      .map((item, index) => (
                        <CombinedReportItem
                          key={`potential-${item.view}-${index}`}
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
              <span className="text-slate-400">{showJson ? "▲" : "▼"}</span>
            </button>
            {showJson && (
              <pre className="overflow-x-auto border-t border-slate-100 bg-slate-900 p-5 text-xs leading-relaxed text-emerald-300">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
