import { LocalizationBadge } from "./PotentialFindingsSection";
import { PART_LOCALIZATION_HELPER } from "./vehiclePartUtils";

export function PartLocalizationNote({ localizationMethod = "rule_based_bbox" }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <LocalizationBadge method={localizationMethod} />
      <p className="text-xs text-slate-500">{PART_LOCALIZATION_HELPER}</p>
    </div>
  );
}
