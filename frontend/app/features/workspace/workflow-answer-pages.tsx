import appStyles from "../../app.module.css";
import uiStyles from "../../components/ui/ui.module.css";
import workspaceStyles from "./workspace.module.css";
import { workflowLabel } from "./workflow-labels";

import { Link, useSearchParams } from "react-router";
import { useState } from "react";
import { Badge, EmptyState, Field, Panel, Select, TextField, Textarea } from "../../components/ui/primitives";
import { type BusinessCase } from "./model";
import { CommandForm, CommandSubmit } from "./command-form";

import { VersionDetails } from "./core-screens";
import { useWorkspace } from "./workspace-context";

import { Pagination } from "../../components/molecules/pagination";
import { WorkflowViews, useClientPage } from "./workflow-navigation";
import { useI18n } from "../../components/ui/display-settings";
import { useCaseVersion, VersionPicker } from "./workflow-common";
export function AnswersScreen({ item }: { item: BusinessCase }) {
  const { t, formatDate, formatNumber } = useI18n();
  const { snapshot, base } = useWorkspace();
  const [search] = useSearchParams();
  const view = search.get("view") || "history";
  const { versions, version } = useCaseVersion(item);
  const [kind, setKind] = useState("受領");
  const options: Record<string, string[]> = {
    閲覧: ["閲覧", "拒否", "保留"],
    受領: ["受領", "拒否", "保留"],
    状態同意: ["同意", "拒否", "保留"],
    作業承認: ["承認", "拒否", "保留"],
  };
  const answers = useClientPage(snapshot.workflow!.answers.filter(a => a.versionId === version?.id), "answerPage");
  const requests = useClientPage(snapshot.workflow!.management.filter(m => m.kind === "confirmation" && !!version && m.detail.startsWith(version.id)), "requestPage");
  const submitted = versions.filter((v) => v.status === "submitted");
  return (
    <>
      <WorkflowViews selected={view} items={[{ view: "request", label: "workflow.nav.request" }, { view: "new", label: "workflow.nav.new" }, { view: "history", label: "workflow.nav.history" }]} />
      <Panel title={t("workflow.confirmationTarget")}>
        <VersionPicker
          versions={submitted}
          selected={version?.status === "submitted" ? version : undefined}
        />
        {version?.status === "submitted" ? (
          <div className={appStyles["mt-5"]}>
            <VersionDetails version={version} />
          </div>
        ) : (
          <p className={uiStyles["ui-muted"]}>{t("workflow.selectSubmitted")}</p>
        )}
      </Panel>
      {version?.status === "submitted" && (
        <>
{view === "request" && (          <Panel title={t("workflow.nav.request")}>
            <CommandForm
              intent="requestConfirmation"
              hidden={{ caseId: item.id, versionId: version.id }}
            >
              <TextField
                id="request-person"
                name="person"
                label={t("workflow.recipient")}
                required
              />
              <Field id="request-kind" label={t("workflow.confirmationKind")}>
                <Select id="request-kind" name="kind">
                  {Object.keys(options).map((k) => (
                    <option key={k} value={k}>{workflowLabel(t, k)}</option>
                  ))}
                </Select>
              </Field>
              <TextField
                id="request-deadline"
                name="deadline"
                type="datetime-local"
                label={t("workflow.deadline")}
                required
              />
              <CommandSubmit>{t("workflow.createRequest")}</CommandSubmit>
            </CommandForm>
          </Panel>)}
{view === "new" && (          <Panel title={t("workflow.recordAnswer")}>
            <CommandForm
              intent="answer"
              hidden={{ caseId: item.id, versionId: version.id }}
            >
              <TextField
                id="answer-person"
                name="person"
                label={t("workflow.respondent")}
                required
              />
              <Field id="answer-kind" label={t("workflow.answerKind")}>
                <Select
                  id="answer-kind"
                  name="kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                >
                  {Object.keys(options).map((k) => (
                    <option key={k} value={k}>{workflowLabel(t, k)}</option>
                  ))}
                </Select>
              </Field>
              <Field id="answer-response" label={t("workflow.answer")}>
                <Select key={kind} id="answer-response" name="response">
                  {options[kind].map((r) => (
                    <option key={r} value={r}>{workflowLabel(t, r)}</option>
                  ))}
                </Select>
              </Field>
              <Field id="answer-text" label={t("workflow.confirmationText")}>
                <Textarea
                  id="answer-text"
                  name="text"
                  key={kind}
                  defaultValue={t("workflow.confirmationStatement", { kind: workflowLabel(t, kind) }) + (kind === "受領" ? t("workflow.receiptStatement") : kind === "作業承認" ? t("workflow.workStatement", { scope: String(version.entries.work_scope ?? t("workflow.notRecorded")), amount: typeof version.entries.estimate === "number" ? formatNumber(version.entries.estimate, { style: "currency", currency: "JPY" }) : t("workflow.notRecorded") }) : "")}
                  required
                />
              </Field>
              <label className={workspaceStyles["workspace-check"]}>
                <input type="checkbox" required />
                {t("workflow.confirmAnswer")}</label>
              <CommandSubmit>{t("workflow.submitAnswer")}</CommandSubmit>
            </CommandForm>
          </Panel>)}
{view === "history" && (          <Panel title={t("workflow.answerHistory")}>
            {snapshot.workflow!.answers.filter(
              (a) => a.versionId === version.id,
            ).length ? (
              <ol className={workspaceStyles["workspace-timeline"]}>
                {answers.data.map((a) => (
                    <li key={a.id}>
                      <strong>{a.person}</strong>{" "}
                      <Badge
                        tone={
                          a.response === "拒否"
                            ? "danger"
                            : a.response === "保留"
                              ? "warning"
                              : "info"
                        }
                      >
                        {workflowLabel(t, a.kind)}：{workflowLabel(t, a.response)}
                      </Badge>
                      <p>{a.text}</p>
                      <p className={uiStyles["ui-muted"]}>{formatDate(a.at)}</p>
                      <Link
                        className={uiStyles["ui-text-link"]}
                        to={`${base}/receipts/${a.id}`}
                      >
                        {t("workflow.openReceipt")}</Link>
                    </li>
                  ))}
              </ol>
            ) : (
              <EmptyState title={t("workflow.unanswered")}>
                {t("workflow.answerVersionNotice")}</EmptyState>
            )}
            <Pagination pagination={answers.pagination} pageKey="answerPage" />
          </Panel>)}
          {view === "history" && <Panel title={t("workflow.requestHistory")}><ol className={workspaceStyles["workspace-timeline"]}>{requests.data.map(request => <li key={request.id}><strong>{request.name}</strong><p>{request.detail}</p><p>{workflowLabel(t, request.status)}</p></li>)}</ol><Pagination pagination={requests.pagination} pageKey="requestPage" /></Panel>}
        </>
      )}
    </>
  );
}
