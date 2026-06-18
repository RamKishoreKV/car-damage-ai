/** Copy for zero-detection inspection states (YOLO returned no supported classes). */

export const NO_MODEL_DETECTED_DAMAGE_TITLE = "No Model-Detected Damage";

export const NO_MODEL_DETECTED_DAMAGE_MESSAGE =
  "The model did not detect supported damage classes in this image.";

export const NO_MODEL_DETECTED_DAMAGE_NOTE =
  "This does not guarantee the vehicle is damage-free. Manual review may still be needed for unsupported damage types or poor image quality.";

export const NO_MODEL_DETECTED_ZERO_ACTION =
  "No supported damage classes detected. Review manually if needed.";

export const NO_MODEL_DETECTED_FLEET_STATUS = "No Model-Detected Damage";

export function NoModelDetectedDamagePanel({ compact = false }) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white text-center shadow-sm ${
        compact ? "p-5" : "p-8"
      }`}
    >
      <h3 className="text-base font-semibold text-slate-900">
        {NO_MODEL_DETECTED_DAMAGE_TITLE}
      </h3>
      <p className="mt-2 text-sm text-slate-600">{NO_MODEL_DETECTED_DAMAGE_MESSAGE}</p>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        {NO_MODEL_DETECTED_DAMAGE_NOTE}
      </p>
    </div>
  );
}
