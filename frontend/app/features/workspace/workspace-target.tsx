import { useSearchParams } from "react-router";
import { useI18n } from "../../components/ui/display-settings";
import { Badge } from "../../components/ui/primitives";
import type { BusinessCase } from "./model";
import { useWorkspace } from "./workspace-context";
import styles from "./workspace-target.module.css";

export function WorkspaceTarget({ item, recordId }: { item: BusinessCase; recordId?: string }) {
  const { snapshot } = useWorkspace();
  const { t, enumLabel, formatNumber } = useI18n();
  const [search] = useSearchParams();
  const vehicle = snapshot.vehicles.find(vehicle => vehicle.id === item.vehicle_id);
  const plate = vehicle?.identifiers.find(identifier => identifier.kind === "plate_number" && !identifier.valid_to)?.value;
  const versions = snapshot.versions.filter(version => version.record_id === recordId && version.case_id === item.id);
  const version = snapshot.selectedVersion ?? (search.has("version") ? versions.find(version => version.id === search.get("version")) : versions.sort((a, b) => b.version_no - a.version_no)[0]);
  return <section className={styles.target} aria-label={t("navigation.caseActions")}>
    <strong>{vehicle?.model_name || t("common.notSet")}</strong>
    <span>{plate || t("common.notSet")}</span>
    <Badge>{enumLabel(item.status === "in_progress" ? "stage" : "caseStatus", item.status === "in_progress" ? item.stage : item.status)}</Badge>
    {version && <span>v{formatNumber(version.version_no)}</span>}
    <details className={styles.identifiers}><summary>ID</summary><dl><dt>{t("navigation.cases")}</dt><dd>{item.id}</dd>{recordId && <><dt>{t("navigation.recordActions")}</dt><dd>{recordId}</dd></>}{version && <><dt>{t("screen.record-history")}</dt><dd>{version.id}</dd></>}</dl></details>
  </section>;
}
