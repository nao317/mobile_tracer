import { Link } from "react-router";
import { Alert, EmptyState } from "../../components/ui/primitives";
import { useTranslation } from "../../components/ui/display-settings";
import { canManage } from "./model";
import { screenAvailable, screenRequiresManagement, type Screen } from "./screens";
import { useWorkspace } from "./workspace-context";
import { WorkspaceShell } from "./workspace-shell";
import { WorkspaceTarget } from "./workspace-target";
import { workspacePages } from "./page-registry";
import styles from "../../components/ui/ui.module.css";

export function WorkspaceView({ screen }: { screen: Screen }) {
  const { snapshot, mode, base } = useWorkspace();
  const t = useTranslation();
  const item = snapshot.cases.find(item => item.id === screen.params.caseId);
  let content;
  if (!screenAvailable(screen.key, mode)) content = <>
    <Alert>{t("error.unavailable")}</Alert>
    <Link className={styles["ui-text-link"]} to={`${base}/cases`}>{t("navigation.cases")}</Link>
  </>;
  else if (screen.params.caseId && !item) content = <EmptyState title={t("error.notFound")} />;
  else if (screenRequiresManagement(screen.key) && !canManage(snapshot.context, item?.store_id)) content = <EmptyState title={t("error.forbidden")} />;
  else content = workspacePages[screen.key]({ screen, item });
  return <WorkspaceShell screen={screen}>
    {item && <WorkspaceTarget item={item} recordId={screen.params.recordId} />}
    <div className={styles["ui-stack"]} key={`${screen.key}:${Object.values(screen.params).join(":")}`}>{content}</div>
  </WorkspaceShell>;
}
