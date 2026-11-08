import { Form, Link } from "react-router";
import { useI18n } from "../../../components/ui/display-settings";
import { Pagination } from "../../../components/molecules/pagination";
import { Alert, Button, EmptyState, Panel, TextField } from "../../../components/ui/primitives";
import { businessTypes } from "../model";
import { demoCaseIds, demoId } from "../preview-data";
import { coreScreens, screenDefinitions } from "../screens";
import { useWorkspace } from "../workspace-context";
import { ViewLinks, styles, ui, useClientPage, useManagementLabels, useView } from "./common";
import { previewViewRoutes } from "./view-catalog";

function UsageSummary() {
  const { snapshot } = useWorkspace();
  const { t, formatNumber } = useI18n();
  const counts = [
    { label: t("previewManagement.caseCount"), count: snapshot.cases.length },
    { label: t("previewManagement.vehicleCount"), count: snapshot.vehicles.length },
    { label: t("previewManagement.photoCount"), count: snapshot.workflow!.photos.length },
    { label: t("previewManagement.failedCount"), count: Object.values(snapshot.workflow!.registration).filter((status) => status === "失敗").length },
  ];
  return <Panel title={t("previewManagement.usage")}>
    <dl className={styles["workspace-summary"]}>{counts.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{formatNumber(item.count)}</dd></div>)}</dl>
    <p className={ui["ui-muted"]}>{t("previewManagement.sampleTotals")}</p>
  </Panel>;
}
export function UsageScreen() {
  const { t } = useI18n();
  const { view, href } = useView("summary");
  return <>
    <ViewLinks selected={href(view)} items={[{ to: href("summary"), label: t("previewManagement.usage") }, { to: href("capacity"), label: t("previewManagement.capacity") }]} />
    {view === "capacity" ? <Panel title={t("previewManagement.capacity")}><Alert tone="warning">{t("previewManagement.capacityNotice")}</Alert></Panel> : <UsageSummary />}
  </>;
}
export function OperationsScreen() {
  const { base } = useWorkspace();
  const { t } = useI18n();
  const { view, href } = useView("operations");
  return <>
    <ViewLinks selected={href(view)} items={[{ to: href("operations"), label: t("previewManagement.operations") }, { to: href("summary"), label: t("previewManagement.usage") }, { to: href("capacity"), label: t("previewManagement.capacity") }]} />
    {view === "summary" ? <UsageSummary /> : view === "capacity" ? <Panel title={t("previewManagement.capacity")}><Alert tone="warning">{t("previewManagement.capacityNotice")}</Alert></Panel>
      : <Panel title={t("previewManagement.operations")}>
        <p className={ui["ui-muted"]}>{t("previewManagement.operationsNotice")}</p>
        <div className={ui["ui-actions"]}>
          <Link className={ui["ui-text-link"]} to={`${base}/operations/environments`}>{t("previewManagement.environments")}</Link>
          <Link className={ui["ui-text-link"]} to={`${base}/operations/imports`}>{t("previewManagement.import")}</Link>
          <Link className={ui["ui-text-link"]} to={`${base}/operations/support`}>{t("previewManagement.access")}</Link>
        </div>
      </Panel>}
  </>;
}
export function AuditScreen() {
  const { snapshot } = useWorkspace();
  const { t, formatDate } = useI18n();
  const { search } = useView("history");
  const labels = useManagementLabels();
  const query = search.get("q") ?? "";
  const audit = snapshot.workflow!.audit.filter((entry) => `${entry.actor} ${entry.action} ${labels.action(entry.action)} ${entry.target}`.toLowerCase().includes(query.toLowerCase()));
  const page = useClientPage(audit);
  return <Panel title={t("previewManagement.audit")}>
    <Form method="get" className={styles["workspace-filter"]}>
      <TextField id="audit-filter" name="q" label={t("previewManagement.auditFilter")} defaultValue={query} />
      <Button type="submit">{t("common.search")}</Button>
    </Form>
    <table className={`${ui["ui-table"]} ${ui["ui-table--responsive"]}`}><thead><tr>
      <th>{t("previewManagement.at")}</th><th>{t("previewManagement.actor")}</th><th>{t("previewManagement.action")}</th><th>{t("previewManagement.target")}</th>
    </tr></thead><tbody>{page.items.map((entry) => <tr key={entry.id}>
      <td data-label={t("previewManagement.at")}>{formatDate(entry.at)}</td><td data-label={t("previewManagement.actor")}>{entry.actor}</td><td data-label={t("previewManagement.action")}>{labels.action(entry.action)}</td><td data-label={t("previewManagement.target")}>{entry.target}</td>
    </tr>)}</tbody></table>
    {!audit.length && <EmptyState title={t("previewManagement.auditEmpty")} />}
    <Pagination pagination={page.pagination} />
  </Panel>;
}
export function CatalogScreen() {
  const { base, snapshot } = useWorkspace();
  const { t, screenTitle, enumLabel } = useI18n();
  const { view, href } = useView("screens");
  const sample: Record<string, string> = { vehicleId: demoId(11), caseId: demoCaseIds[0], recordId: demoId(32), shareId: demoId(91), answerId: demoId(71) };
  const entries = [
    ...screenDefinitions.filter((screen) => screen.key !== "catalog").map((screen) => ({
      id: screen.key,
      label: screenTitle(screen.key),
      to: `${base}/${screen.path.replace(/:(\w+)/g, (_, key: string) => sample[key])}`,
      live: coreScreens.has(screen.key),
    })),
    ...previewViewRoutes(snapshot, base).map((route) => ({
      id: route.id,
      label: `${screenTitle(route.screen)} / ${t(route.labelKey)}`,
      to: route.to,
      live: coreScreens.has(route.screen),
    })),
  ];
  const page = useClientPage(entries);
  return <>
    <ViewLinks selected={href(view)} items={[{ to: href("screens"), label: t("previewManagement.catalog") }, { to: href("flows"), label: t("previewManagement.catalogFlows") }]} />
    {view === "flows" ? <Panel title={t("previewManagement.catalogFlows")}><div className={ui["ui-actions"]}>
      {Object.keys(businessTypes).map((business, index) => <Link key={business} className={ui["ui-link-button"]} to={`${base}/cases/${demoCaseIds[index]}`}>{enumLabel("business", business)}</Link>)}
    </div></Panel> : <Panel title={t("previewManagement.catalog")}>
      <div className={ui["ui-stack"]}>{page.items.map((screen) => <article key={screen.id} className={styles["workspace-catalog-card"]}>
        <Link to={screen.to}>{screen.label}</Link>
        <span>{t(screen.live ? "previewManagement.catalogLive" : "previewManagement.catalogPreview")}</span>
      </article>)}</div>
      <Pagination pagination={page.pagination} />
    </Panel>}
  </>;
}
