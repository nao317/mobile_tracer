import appStyles from "../../app.module.css";
import uiStyles from "../../components/ui/ui.module.css";
import workspaceStyles from "./workspace.module.css";
import { workflowLabel } from "./workflow-labels";

import { useSearchParams } from "react-router";

import { Badge, EmptyState, Field, Panel, Select } from "../../components/ui/primitives";
import { canManage, type BusinessCase } from "./model";
import { CommandForm, CommandSubmit } from "./command-form";

import { VersionDetails } from "./core-screens";
import { useWorkspace } from "./workspace-context";

import { Pagination } from "../../components/molecules/pagination";
import { WorkflowViews, useClientPage } from "./workflow-navigation";
import { useI18n } from "../../components/ui/display-settings";
import { useCaseVersion, VersionPicker } from "./workflow-common";
export function VerificationScreen({ item }: { item: BusinessCase }) {
  const { t, formatDate } = useI18n();
  const { snapshot } = useWorkspace();
  const { versions, version } = useCaseVersion(item);
  const [search] = useSearchParams();
  const view = search.get("view") || "registration";
  const history = useClientPage(snapshot.workflow!.audit.filter(a => a.target === version?.id), "historyPage");
  if (!version) return <EmptyState title={t("workflow.noRecords")} />;
  const registration = snapshot.workflow!.registration[version.id] ?? "未登録",
    verification = snapshot.workflow!.verification[version.id] ?? "未実施";
  return (
    <>
      <WorkflowViews selected={view} items={[{ view: "registration", label: "workflow.nav.registration" }, { view: "check", label: "workflow.nav.check" }, { view: "history", label: "workflow.nav.history" }]} />
      <Panel title={t("workflow.selectedVersion")}>
        <VersionPicker versions={versions} selected={version} />
        <div className={appStyles["mt-5"]}>
          <VersionDetails version={version} />
        </div>
      </Panel>
      <div className={uiStyles["ui-grid"]}>
{view === "registration" && (        <Panel title={t("workflow.registration")}>
          <Badge
            tone={
              registration === "失敗"
                ? "danger"
                : registration === "登録済み"
                  ? "success"
                  : "warning"
            }
          >
            {workflowLabel(t, registration)}
          </Badge>
          <p className={`${uiStyles["ui-muted"]} ${appStyles["mt-4"]}`}>
            {t("workflow.targetPrefix")}{version.id}
            <br />
            {t("workflow.registrationMethod")}</p>
          {version.status === "submitted" &&
            canManage(snapshot.context, item.store_id) && (
              <CommandForm
                intent="retryRegistration"
                hidden={{ caseId: item.id, versionId: version.id }}
              >
                <label className={workspaceStyles["workspace-check"]}>
                  <input type="checkbox" required />
                  {t("workflow.confirmRegistration")}</label>
                <CommandSubmit>{t("workflow.retryRegistration")}</CommandSubmit>
              </CommandForm>
            )}
        </Panel>)}
{view === "check" && (        <Panel title={t("workflow.verification")}>
          <Badge
            tone={
              verification === "不一致"
                ? "danger"
                : verification === "一致"
                  ? "success"
                  : "warning"
            }
          >
            {workflowLabel(t, verification)}
          </Badge>
          <p className={`${uiStyles["ui-muted"]} ${appStyles["mt-4"]}`}>
            {t("workflow.verificationNotice")}</p>
          {version.status === "submitted" && (
            <CommandForm
              intent="verify"
              hidden={{ caseId: item.id, versionId: version.id }}
            >
              <Field id="verification-result" label={t("workflow.verificationSample")}>
                <Select id="verification-result" name="result">
                  <option value="一致">{t("workflow.match")}</option>
                  <option value="不一致">{t("workflow.mismatch")}</option>
                </Select>
              </Field>
              <CommandSubmit>{t("workflow.checkResult")}</CommandSubmit>
            </CommandForm>
          )}
        </Panel>)}
      </div>
{view === "history" && (      <Panel title={t("workflow.processingHistory")}>
        <ol className={workspaceStyles["workspace-timeline"]}>
          {history.data.map((a) => (
              <li key={a.id}>
                {a.action} / {formatDate(a.at)}
              </li>
            ))}
        </ol><Pagination pagination={history.pagination} pageKey="historyPage" />
      </Panel>)}
    </>
  );
}
