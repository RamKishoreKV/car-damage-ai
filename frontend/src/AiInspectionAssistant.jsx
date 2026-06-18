import { fleetDecisionBadgeClass } from "./aiInspectorUtils";

export default function AiInspectionAssistant({ aiInspection }) {
  if (!aiInspection) return null;

  const {
    source,
    summary,
    risk_assessment: riskAssessment,
    recommended_next_steps: steps,
    fleet_decision: fleetDecision,
  } = aiInspection;

  const usedFallback = source === "fallback" || source !== "ollama";

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-cyan-50/40 p-6 shadow-saas-lg">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-500" aria-hidden="true" />
            AI Assistant
          </div>
          <h3 className="text-xl font-semibold text-slate-900">AI Inspection Assistant</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Grounded summary generated from structured detections only.
          </p>
        </div>
        {fleetDecision && (
          <span
            className={`rounded-full px-4 py-1.5 text-xs font-semibold shadow-sm ${fleetDecisionBadgeClass(
              fleetDecision,
            )}`}
          >
            {fleetDecision}
          </span>
        )}
      </div>

      {usedFallback && (
        <p role="note" className="mb-4 text-xs text-slate-500">
          Using rule-based fallback summary.
        </p>
      )}

      {summary && (
        <div className="rounded-xl border border-slate-200/80 bg-white/90 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Summary
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{summary}</p>
        </div>
      )}

      {riskAssessment && (
        <div className="mt-4 rounded-xl border border-slate-200/80 bg-white/90 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Risk Assessment
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{riskAssessment}</p>
        </div>
      )}

      {Array.isArray(steps) && steps.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200/80 bg-white/90 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Recommended Next Steps
          </p>
          <ul className="mt-3 space-y-2">
            {steps.map((step) => (
              <li key={step} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="mt-0.5 text-cyan-600" aria-hidden="true">
                  →
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
