import { Link } from "react-router";
import { useI18n } from "../../../components/ui/display-settings";
import { Alert, Badge, EmptyState, Panel } from "../../../components/ui/primitives";
import { VersionDetails } from "../core-screens";
import { demoId } from "../preview-data";
import { useWorkspace } from "../workspace-context";
import { BackLink, ItemHistory, ManagementList, ViewLinks, ui, useView } from "./common";

export function SupportAccessScreen() {
  const { snapshot } = useWorkspace();
  const { t } = useI18n();
  const { view, href, search } = useView("permissions");
  const permissions = snapshot.workflow!.management.filter((item) => item.kind === "support");
  const permission = permissions.find((item) => item.id === search.get("item"));
  const version = snapshot.versions.find((item) => item.id === demoId(41));
  let content;
  if (view === "record") content = permission?.status === "許可中" && version ? <Panel title={t("previewManagement.accessRecord")}>
    <BackLink to={href("detail", permission.id)} />
    <Badge>{t("previewManagement.accessBadge")}</Badge>
    <VersionDetails version={version} />
  </Panel> : <EmptyState title={t("previewManagement.accessNone")} />;
  else if (view === "detail") content = permission ? <>
    <BackLink to={href("permissions")} />
    <Panel title={t("previewManagement.access")}>
      <strong>{permission.name}</strong><p>{permission.detail}</p>
      <Alert tone="warning">{t("previewManagement.accessNotice")}</Alert>
      <p className={ui["ui-muted"]}>{t("previewManagement.accessSample")}</p>
      {permission.status === "許可中" ? <Link className={ui["ui-link-button"]} to={href("record", permission.id)}>{t("previewManagement.accessOpen")}</Link> : <EmptyState title={t("previewManagement.accessNone")} />}
    </Panel><ItemHistory item={permission} />
  </> : <EmptyState title={t("previewManagement.missing")} />;
  else content = <Panel title={t("previewManagement.access")}><ManagementList items={permissions} detailView="detail" /></Panel>;
  return <><ViewLinks selected={href(view)} items={[{ to: href("permissions"), label: t("previewManagement.access") }]} />{content}</>;
}
