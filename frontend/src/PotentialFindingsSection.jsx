import { capitalize, formatVehiclePart, localizationMethodBadgeClass, localizationMethodLabel, potentialFindingBadgeClass, severityBadgeClass, verificationRequiredBadgeClass } from "./inspectionUtils";
import { POTENTIAL_FINDINGS_TITLE } from "./vehiclePartUtils";

function VerificationBadge() {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${verificationRequiredBadgeClass()}`}>
      Verification Required
    </span>
  );
}

function PotentialFindingBadge() {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${potentialFindingBadgeClass()}`}>
      Potential Finding
    </span>
  );
}

export function LocalizationBadge({ method = "rule_based_bbox" }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${localizationMethodBadgeClass(method)}`}
    >
      {localizationMethodLabel(method)}
    </span>
  );
}

export function DetectionCard({
  det,
  index,
  formatConfidence,
  formatBbox,
  variant = "confirmed",
}) {
  const isPotential = variant === "potential";

  return (
    <article
      key={`${det.damage_type}-${index}`}
      className={`rounded-2xl border p-5 shadow-sm ${
        isPotential
          ? "border-amber-200 bg-amber-50/40"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            {capitalize(det.damage_type)}
          </h3>
          {det.finding_type && (
            <p className="mt-1 text-xs font-medium text-amber-700">{det.finding_type}</p>
          )}
          {det.vehicle_part && (
            <p className="mt-1 text-sm text-slate-600">
              Likely Vehicle Part:{" "}
              <span className="font-medium text-slate-800">
                {formatVehiclePart(det.vehicle_part)}
              </span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {isPotential ? <PotentialFindingBadge /> : null}
          {det.localization_method && (
            <LocalizationBadge method={det.localization_method} />
          )}
          <span
            className={`rounded-lg px-2 py-0.5 text-xs font-bold ${
              isPotential
                ? "bg-violet-100 text-violet-800"
                : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {formatConfidence(det.confidence)}
          </span>
          {isPotential && <VerificationBadge />}
        </div>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        {det.vehicle_part && (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Likely Vehicle Part</dt>
            <dd className="font-medium text-slate-800">
              {formatVehiclePart(det.vehicle_part)}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Confidence</dt>
          <dd className="font-medium text-slate-800">
            {formatConfidence(det.confidence)}
          </dd>
        </div>
        {det.part_confidence != null && (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Part Confidence</dt>
            <dd className="font-medium text-slate-800">
              {formatConfidence(det.part_confidence)}
            </dd>
          </div>
        )}
        {det.localization_method && (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Localization Method</dt>
            <dd className="font-medium text-slate-800">
              {localizationMethodLabel(det.localization_method)}
            </dd>
          </div>
        )}
        {det.part_bbox && (
          <div>
            <dt className="text-slate-500">Part Bounding Box</dt>
            <dd className="mt-1 font-mono text-xs text-slate-700">
              {formatBbox(det.part_bbox)}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-slate-500">Bounding Box</dt>
          <dd className="mt-1 font-mono text-xs text-slate-700">
            {formatBbox(det.bbox)}
          </dd>
          <p className="mt-0.5 text-xs text-slate-400">[x1, y1, x2, y2] in pixels</p>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Mask available</dt>
          <dd className="font-medium text-slate-800">{det.has_mask ? "Yes" : "No"}</dd>
        </div>
        {det.severity && (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Severity (capped)</dt>
            <dd className="font-medium text-slate-800">{det.severity}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

export function PotentialDetectionsSection({
  detections,
  formatConfidence,
  formatBbox,
}) {
  if (!detections?.length) return null;

  return (
    <div className="mt-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-amber-900">{POTENTIAL_FINDINGS_TITLE}</h3>
        <p className="mt-1 text-sm text-amber-800/80">
          Confidence below 40% — verify with a closer photo before escalating severity.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {detections.map((det, index) => (
          <DetectionCard
            key={`potential-${det.damage_type}-${index}`}
            det={det}
            index={index}
            formatConfidence={formatConfidence}
            formatBbox={formatBbox}
            variant="potential"
          />
        ))}
      </div>
    </div>
  );
}

export function FindingCard({ finding, formatConfidence, formatBbox }) {
  return (
    <article className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Potential Finding {finding.id}
          </p>
          <h4 className="mt-1 text-lg font-semibold text-slate-900">
            {finding.damageType}
          </h4>
        </div>
        <div className="flex flex-col items-end gap-2">
          <PotentialFindingBadge />
          {finding.localizationMethod && (
            <LocalizationBadge method={finding.localizationMethod} />
          )}
          <VerificationBadge />
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${severityBadgeClass(
              finding.severity,
            )}`}
          >
            {finding.severity} Severity (capped)
          </span>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4 sm:block">
          <dt className="text-slate-500">Likely Vehicle Part</dt>
          <dd className="font-medium text-slate-800">{finding.likelyVehiclePart}</dd>
        </div>
        <div className="flex justify-between gap-4 sm:block">
          <dt className="text-slate-500">Confidence</dt>
          <dd className="font-medium text-slate-800">
            {formatConfidence(finding.confidence)}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-slate-500">Suggested Action</dt>
          <dd className="mt-1 text-slate-700">{finding.suggestedAction}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-slate-500">Bounding Box</dt>
          <dd className="mt-1 font-mono text-xs text-slate-700">
            {formatBbox(finding.bbox)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function PotentialFindingsReportSection({
  findings,
  formatConfidence,
  formatBbox,
}) {
  if (!findings?.length) return null;

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-700">
        {POTENTIAL_FINDINGS_TITLE}
      </h3>
      <p className="mb-4 text-sm text-amber-800/80">
        Low-confidence detections are listed separately and do not increase overall severity.
      </p>
      <div className="space-y-4">
        {findings.map((finding) => (
          <FindingCard
            key={`potential-finding-${finding.id}-${finding.damageType}`}
            finding={finding}
            formatConfidence={formatConfidence}
            formatBbox={formatBbox}
          />
        ))}
      </div>
    </div>
  );
}

export function CombinedReportItem({ item, index, viewLabel, formatConfidence }) {
  const isPotential = item.verification_required;

  return (
    <article
      key={`${item.view}-${item.damage_type}-${index}`}
      className={`rounded-xl border p-4 ${
        isPotential
          ? "border-amber-200 bg-amber-50/50"
          : "border-slate-200 bg-slate-50/70"
      }`}
    >
        <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p
            className={`text-xs font-semibold uppercase tracking-wide ${
              isPotential ? "text-amber-700" : "text-brand-600"
            }`}
          >
            {isPotential ? "Potential — " : ""}
            {viewLabel(item.view)}
          </p>
          <h4 className="mt-1 font-semibold text-slate-900">
            {formatVehiclePart(item.vehicle_part) || capitalize(item.damage_type)}
          </h4>
          <p className="mt-0.5 text-sm text-slate-600">
            {capitalize(item.damage_type)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {isPotential && <PotentialFindingBadge />}
          {item.localization_method && (
            <LocalizationBadge method={item.localization_method} />
          )}
          {isPotential && <VerificationBadge />}
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${severityBadgeClass(
              item.severity,
            )}`}
          >
            {item.severity}
            {isPotential ? " (capped)" : ""}
          </span>
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Likely Vehicle Part</dt>
          <dd className="font-medium text-slate-800">
            {formatVehiclePart(item.vehicle_part) || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Damage Type</dt>
          <dd className="font-medium text-slate-800">{capitalize(item.damage_type)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Confidence</dt>
          <dd className="font-medium text-slate-800">
            {formatConfidence(item.confidence)}
          </dd>
        </div>
        {item.part_confidence != null && (
          <div>
            <dt className="text-slate-500">Part Confidence</dt>
            <dd className="font-medium text-slate-800">
              {formatConfidence(item.part_confidence)}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-slate-500">Localization Method</dt>
          <dd className="font-medium text-slate-800">
            {localizationMethodLabel(item.localization_method || "rule_based_bbox")}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-slate-500">Suggested Action</dt>
          <dd className="mt-1 text-slate-700">{item.suggested_action}</dd>
        </div>
      </dl>
    </article>
  );
}
