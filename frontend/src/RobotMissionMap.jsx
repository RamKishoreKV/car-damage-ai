import { ACTIVE_CAPTURE_BY_STATE } from "./robotMissionConstants";

const CAPTURE_POINTS = [
  { view: "front", label: "Front", style: "top-2 left-1/2 -translate-x-1/2" },
  { view: "left_side", label: "Left", style: "left-2 top-1/2 -translate-y-1/2" },
  { view: "right_side", label: "Right", style: "right-2 top-1/2 -translate-y-1/2" },
  { view: "rear", label: "Rear", style: "bottom-2 left-1/2 -translate-x-1/2" },
];

export default function RobotMissionMap({ currentState, capturedViews = [] }) {
  const activeView = ACTIVE_CAPTURE_BY_STATE[currentState] || null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 shadow-inner">
      <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
        Simulated Robot Route
      </p>
      <div className="relative mx-auto aspect-square max-w-xs">
        <div className="absolute inset-8 rounded-2xl border border-dashed border-slate-600/60" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative z-10 flex h-24 w-40 flex-col items-center justify-center rounded-xl border border-brand-400/40 bg-brand-500/20 shadow-lg shadow-brand-900/30">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-200">
              Vehicle
            </span>
            <div className="mt-2 h-8 w-28 rounded-md bg-slate-700/80 ring-1 ring-slate-500/50" />
          </div>
        </div>

        {CAPTURE_POINTS.map((point) => {
          const isActive = activeView === point.view;
          const isCaptured = capturedViews.includes(point.view);

          return (
            <div
              key={point.view}
              className={`absolute ${point.style} z-20 flex flex-col items-center gap-1`}
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-500 ${
                  isActive
                    ? "scale-110 border-amber-300 bg-amber-400 text-amber-950 shadow-lg shadow-amber-500/40 animate-pulse"
                    : isCaptured
                      ? "border-emerald-400 bg-emerald-500/90 text-white"
                      : "border-slate-500 bg-slate-700/80 text-slate-300"
                }`}
              >
                {isCaptured && !isActive ? "✓" : "●"}
              </div>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  isActive
                    ? "bg-amber-400 text-amber-950"
                    : isCaptured
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-slate-800/80 text-slate-400"
                }`}
              >
                {point.label}
              </span>
            </div>
          );
        })}

        {activeView && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            aria-hidden="true"
          >
            <line
              x1="50"
              y1="50"
              x2={
                activeView === "front"
                  ? 50
                  : activeView === "rear"
                    ? 50
                    : activeView === "left_side"
                      ? 12
                      : 88
              }
              y2={
                activeView === "front"
                  ? 12
                  : activeView === "rear"
                    ? 88
                    : 50
              }
              stroke="rgb(251 191 36)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              className="animate-pulse"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
