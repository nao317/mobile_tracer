import { Alert, EmptyState, Field, Panel, Select, Textarea } from "../../../components/ui/primitives";
import appStyles from "../../../app.module.css";
import workspaceStyles from "../workspace.module.css";
import { canManage, canWrite, rulesFor, type BusinessCase } from "../model";
import { CommandForm, CommandSubmit } from "../command-form";
import { useWorkspace } from "../workspace-context";
import { CoreBackLink } from "./navigation";
import { useCoreI18n } from "./core-messages";

export function CaseManageScreen({ item }: { item: BusinessCase }) {
  const { c, t, enumLabel } = useCoreI18n();
  const { snapshot, mode, base } = useWorkspace();
  const rules = rulesFor(snapshot, item);
  const manager = canManage(snapshot.context, item.store_id);
  const back = <CoreBackLink to={`${base}/cases/${item.id}`} />;

  if (!canWrite(snapshot.context, item)) return <>{back}<EmptyState title={t("error.forbidden")} /></>;
  return <>
    {back}
    <Panel title={c("workspace.case.manage")}>
      {manager && <details className={workspaceStyles["workspace-details"]}>
        <summary>{c("workspace.case.assignPrompt")}</summary>
        <CommandForm intent="assignCase" hidden={{ caseId: item.id }}>
          <Field id="assignment" label={c("workspace.case.assignee")}>
            <Select id="assignment" name="assignment" defaultValue={item.assignee_id === snapshot.context.principal.staff_id ? "self" : "unassigned"}>
              <option value="self">{c("workspace.case.self")}</option>
              <option value="unassigned">{c("workspace.case.unassigned")}</option>
            </Select>
          </Field>
          <CommandSubmit>{c("workspace.case.assign")}</CommandSubmit>
        </CommandForm>
      </details>}
      {rules && <details className={workspaceStyles["workspace-details"]}>
        <summary>{c("workspace.case.stagePrompt")}</summary>
        <CommandForm intent="updateCase" hidden={{ caseId: item.id }}>
          <Field id="stage" label={c("workspace.case.nextStage")}>
            <Select id="stage" name="stage" required>
              <option value="">{c("workspace.case.chooseStage")}</option>
              {rules.transitions[item.stage]?.map(stage => <option key={stage} value={stage}>{enumLabel("stage", stage)}</option>)}
            </Select>
          </Field>
          <CommandSubmit>{c("workspace.case.changeStage")}</CommandSubmit>
        </CommandForm>
      </details>}
    </Panel>
    {manager && <Panel title={c("workspace.case.close")}>
      <details>
        <summary className={appStyles["cursor-pointer"]}>{c("workspace.case.cancelPrompt")}</summary>
        <CommandForm intent="cancelCase" hidden={{ caseId: item.id }}>
          <Field id="reason" label={c("workspace.case.cancelReason")}>
            <Textarea id="reason" name="reason" maxLength={2000} required />
          </Field>
          <label className={workspaceStyles["workspace-check"]}>
            <input type="checkbox" required />{c("workspace.case.confirmCancel")}
          </label>
          <CommandSubmit variant="danger">{c("workspace.case.cancel")}</CommandSubmit>
        </CommandForm>
      </details>
      {mode === "preview" && <details className={workspaceStyles["workspace-details"]}>
        <summary>{c("workspace.case.completePrompt")}</summary>
        <CommandForm intent="completeCase" hidden={{ caseId: item.id }}>
          <Alert tone="warning">{c("workspace.case.completionNotice")}</Alert>
          <label className={workspaceStyles["workspace-check"]}>
            <input type="checkbox" required />{c("workspace.case.confirmComplete")}
          </label>
          <CommandSubmit>{c("workspace.case.complete")}</CommandSubmit>
        </CommandForm>
      </details>}
    </Panel>}
  </>;
}
