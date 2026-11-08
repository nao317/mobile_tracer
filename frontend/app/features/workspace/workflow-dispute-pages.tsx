import uiStyles from "../../components/ui/ui.module.css";
import workspaceStyles from "./workspace.module.css";
import { workflowLabel } from "./workflow-labels";

import { useSearchParams } from "react-router";

import { Badge, EmptyState, Field, Panel, Select, TextField, Textarea } from "../../components/ui/primitives";
import { canManage, type BusinessCase } from "./model";
import { CommandForm, CommandSubmit } from "./command-form";


import { useWorkspace } from "./workspace-context";

import { Pagination } from "../../components/molecules/pagination";
import { WorkflowViews, WorkflowLink, useClientPage } from "./workflow-navigation";
import { useI18n } from "../../components/ui/display-settings";
import { useCaseVersion, VersionPicker } from "./workflow-common";
export function DisputesScreen({ item }: { item: BusinessCase }) {
  const { t } = useI18n();
  const { snapshot } = useWorkspace();
  const { versions, version } = useCaseVersion(item);
  const [search] = useSearchParams();
  const view = search.get("view") || "list";
  const disputes = useClientPage(snapshot.workflow!.disputes.filter(d => d.caseId === item.id), "disputePage");
  const selected = snapshot.workflow!.disputes.find(d => d.caseId === item.id && d.id === search.get("item"));
  const history = useClientPage(selected?.history ?? [], "historyPage");
  return (
    <>
      <WorkflowViews selected={view} items={[{ view: "list", label: "workflow.nav.list" }, { view: "new", label: "workflow.nav.new" }]} />
{view === "new" && (      <Panel title={t("workflow.newDispute")}>
        <VersionPicker
          versions={versions.filter((v) => v.status === "submitted")}
          selected={version?.status === "submitted" ? version : undefined}
        />
        {version?.status === "submitted" && (
          <CommandForm
            intent="newDispute"
            hidden={{ caseId: item.id, versionId: version.id }}
          >
            <Field id="dispute-text" label={t("workflow.disputeText")}>
              <Textarea id="dispute-text" name="text" required />
            </Field>
            <CommandSubmit>{t("workflow.newDispute")}</CommandSubmit>
          </CommandForm>
        )}
      </Panel>)}
      {view === "list" && <Panel title={t("workflow.disputeList")}>{disputes.data.length ? <ul className={uiStyles["ui-stack"]}>{disputes.data.map(d => <li key={d.id}><WorkflowLink view="detail" item={d.id}>{d.text}</WorkflowLink></li>)}</ul> : <EmptyState title={t("workflow.noDisputes")} />}<Pagination pagination={disputes.pagination} pageKey="disputePage" /></Panel>}
      {["detail", "history"].includes(view) && !selected && <EmptyState title={t("workflow.disputeNotFound")} />}
      {[...(["detail", "history"].includes(view) && selected ? [selected] : [])]        .map((d) => (
          <Panel
            key={d.id}
            title={d.text}
            actions={
              <Badge tone={d.status === "解決" ? "success" : "warning"}>
                {workflowLabel(t, d.status)}
              </Badge>
            }
          >
            <p className={uiStyles["ui-muted"]}>{t("workflow.versionPrefix")}{d.versionId}</p>
            <div className={uiStyles["ui-actions"]}><WorkflowLink view="detail" item={d.id}>{t("workflow.disputeDetail")}</WorkflowLink><WorkflowLink view="history" item={d.id}>{t("workflow.disputeHistory")}</WorkflowLink></div>
            {view === "history" && <><ol className={workspaceStyles["workspace-timeline"]}>
              {history.data.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ol><Pagination pagination={history.pagination} pageKey="historyPage" /></>}
            {view === "detail" && canManage(snapshot.context, item.store_id) && (
              <details className={workspaceStyles["workspace-details"]}>
                <summary>{t("workflow.advanceDispute")}</summary>
                <CommandForm
                  intent="advanceDispute"
                  hidden={{ caseId: item.id, disputeId: d.id }}
                >
                  <Field id={`dispute-status-${d.id}`} label={t("workflow.disputeStatus")}>
                    <Select id={`dispute-status-${d.id}`} name="status">
                      {["対応中", "再確認待ち", "解決", "再開"].map((s) => (
                        <option key={s} value={s}>{workflowLabel(t, s)}</option>
                      ))}
                    </Select>
                  </Field>
                  <TextField
                    id={`dispute-note-${d.id}`}
                    name="note"
                    label={t("workflow.disputeNote")}
                    required
                  />
                  <CommandSubmit>{t("workflow.addHistory")}</CommandSubmit>
                </CommandForm>
              </details>
            )}
          </Panel>
        ))}
    </>
  );
}
