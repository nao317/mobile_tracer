import { CoreBackLink } from "./navigation";
import appStyles from "../../../app.module.css";
import workspaceStyles from "../workspace.module.css";
import { useCoreI18n } from "./core-messages";

import { Alert, Panel } from "../../../components/ui/primitives";
import { rulesFor, type BusinessCase } from "../model";

import { useWorkspace } from "../workspace-context";
import { Link } from "react-router";

export function CaseScreen({ item }: { item: BusinessCase; }) {
  const { c, enumLabel, formatDate } = useCoreI18n();

  const { snapshot, base, mode } = useWorkspace();
  const rules = rulesFor(snapshot, item);
  return (
    <>
      <CoreBackLink to={`${base}/cases`} />
      {mode === "live" && item.status === "awaiting_customer" && (
        <Alert tone="warning">
          顧客の開始承認待ちです。承認されるまで、記録の作成・編集や案件の変更はできません。
          <Link to={`/casework/${item.id}/start`}>開始条件・承認を開く</Link>
        </Alert>
      )}
      <Panel title={c("workspace.case.progress")}>
    <div className={workspaceStyles["workspace-step"]}>
      {rules?.stages.map((stage) => (
        <span key={stage}>
          {enumLabel("stage", stage)}
          {stage === item.stage ? c("workspace.case.current") : ""}
        </span>
      ))}
    </div>
    <dl className={[workspaceStyles["workspace-summary"], appStyles["mt-5"]].join(" ")}>
      <div>
        <dt>{c("workspace.case.assignee")}</dt>
        <dd>
          {item.assignee_id === snapshot.context.principal.staff_id
            ? c("workspace.case.self")
            : item.assignee_id
              ? c("workspace.case.assigned")
              : c("workspace.case.unassigned")}
        </dd>
      </div>
      <div>
        <dt>{c("workspace.common.createdAt")}</dt>
        <dd>{formatDate(item.created_at)}</dd>
      </div>
      <div>
        <dt>{c("workspace.case.configurationVersion")}</dt>
        <dd>{item.configuration_version_id.slice(-8)}</dd>
      </div>
    </dl>
    {item.cancel_reason && (
      <Alert tone="warning">{c("workspace.case.cancelReasonPrefix")}{item.cancel_reason}</Alert>
    )}
  </Panel>
    </>
  );
}
