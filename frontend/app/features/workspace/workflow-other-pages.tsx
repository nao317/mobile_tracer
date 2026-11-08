import appStyles from "../../app.module.css";
import uiStyles from "../../components/ui/ui.module.css";
import { workflowLabel } from "./workflow-labels";
import { Camera } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { Alert, Badge, Button, EmptyState, Field, Panel, Select, TextField } from "../../components/ui/primitives";
import { canManage, type BusinessCase } from "./model";
import { CommandForm, CommandSubmit } from "./command-form";

import { VersionDetails } from "./core-screens";
import { useWorkspace } from "./workspace-context";

import { Pagination } from "../../components/molecules/pagination";
import { useClientPage } from "./workflow-navigation";
import { useI18n } from "../../components/ui/display-settings";
import { useCaseVersion, VersionPicker, PhotoCard } from "./workflow-common";
function downloadJson(name: string, content: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ExportScreen({ item }: { item: BusinessCase }) {
  const { t } = useI18n();
  const { snapshot } = useWorkspace();
  const { versions, version } = useCaseVersion(item);
  const answers = useClientPage(snapshot.workflow!.answers.filter(answer => answer.versionId === version?.id), "answerPage");
  const disputes = useClientPage(snapshot.workflow!.disputes.filter(dispute => dispute.versionId === version?.id), "disputePage");
  return (
    <>
      <Panel title={t("workflow.exportTarget")}>
        <VersionPicker
          versions={versions.filter((v) => v.status === "submitted")}
          selected={version?.status === "submitted" ? version : undefined}
        />
      </Panel>
      {version?.status === "submitted" && (
        <Panel title={t("workflow.reportPreview")}>
          <p className={uiStyles["ui-muted"]}>
            {t("workflow.versionPrefix")}{version.id} {t("workflow.reportScope")}</p>
          <VersionDetails version={version} />
          <h3 className={`${appStyles["font-semibold"]} ${appStyles["mt-5"]}`}>{t("workflow.reportHistory")}</h3>
          {answers.data.map((a) => (
              <p key={a.id}>
                {a.person}：{workflowLabel(t, a.kind)} / {workflowLabel(t, a.response)}
              </p>
            ))}
          <Pagination pagination={answers.pagination} pageKey="answerPage" />
          {!snapshot.workflow!.answers.some(
            (a) => a.versionId === version.id,
          ) && <p>{t("workflow.noAnswer")}</p>}
          {disputes.data.map((d) => (
              <p key={d.id}>
                {workflowLabel(t, d.status)}：{d.text}
              </p>
            ))}
          <Pagination pagination={disputes.pagination} pageKey="disputePage" />
          <p>
            {t("workflow.registrationPrefix")}{workflowLabel(t, snapshot.workflow!.registration[version.id] ?? "未登録")}{" "}
            {t("workflow.verificationPrefix")}{workflowLabel(t, snapshot.workflow!.verification[version.id] ?? "未実施")}
          </p>
          <div className={`${uiStyles["ui-actions"]} ${appStyles["mt-5"]}`}>
            <Button onClick={() => window.print()}>
              {t("workflow.printReport")}</Button>
            <Button
              variant="secondary"
              onClick={() =>
                downloadJson(`record-v${version.version_no}.json`, {
                  preview: true,
                  exportedAt: new Date().toISOString(),
                  scope: "担当者向けサンプル",
                  version,
                  answers: snapshot.workflow!.answers.filter(
                    (a) => a.versionId === version.id,
                  ),
                  disputes: snapshot.workflow!.disputes.filter(
                    (d) => d.versionId === version.id,
                  ),
                  registration:
                    snapshot.workflow!.registration[version.id] ?? "未登録",
                  verification:
                    snapshot.workflow!.verification[version.id] ?? "未実施",
                })
              }
            >
              {t("workflow.exportData")}</Button>
          </div>
        </Panel>
      )}
    </>
  );
}
export function RecipientScreen({ shareId }: { shareId: string }) {
  const { t, formatDate } = useI18n();
  const { snapshot, base } = useWorkspace();
  const [search] = useSearchParams();
  const share = snapshot.workflow!.shares.find((s) => s.id === shareId),
    version = snapshot.versions.find((v) => v.id === share?.versionId);
  const photos = useClientPage(snapshot.workflow!.photos.filter(photo => photo.versionId === version?.id), "photoPage");
  if (!share || !version) return <EmptyState title={t("workflow.shareNotFound")} />;
  if (
    share.status !== "active" ||
    Date.parse(share.expires) <= Date.parse(snapshot.asOf ?? "1970-01-01") ||
    search.get("expired") === "1"
  )
    return (
      <EmptyState
        title={
          share.status === "revoked"
            ? t("workflow.revoked")
            : t("workflow.expired")
        }
      >
        {t("workflow.expiredNotice")}</EmptyState>
    );
  return (
    <>
      <Panel title={t("workflow.sharedRecord")}>
        <p className={uiStyles["ui-muted"]}>
          {t("workflow.scopePrefix")}{workflowLabel(t, share.scope)} {t("workflow.expiresPrefix")}{formatDate(share.expires)}
        </p>
        <VersionDetails version={version} />
        {share.scope.includes("写真") && (
          <div className={`${uiStyles["ui-grid"]} ${appStyles["mt-5"]}`}>
            {photos.data.map((p) => (
                <PhotoCard
                  key={p.id}
                  photo={p}
                  position={p.position}
                  variant="public"
                />
              ))}
          </div>
        )}
        {share.scope.includes("写真") && <Pagination pagination={photos.pagination} pageKey="photoPage" />}
        <Alert>{t("workflow.limitedHistory")}</Alert>
        <Link className={uiStyles["ui-text-link"]} to={`${base}/receipts/${share.id}`}>
          {t("workflow.getPresentedCopy")}</Link>
        <Link
          className={uiStyles["ui-text-link"]}
          to={`${base}/cases/${version.case_id}/answers?version=${version.id}&view=new`}
        >
          {t("workflow.answerPresented")}</Link>
      </Panel>
    </>
  );
}
export function ReceiptScreen({ answerId }: { answerId: string }) {
  const { t, formatDate } = useI18n();
  const { snapshot } = useWorkspace();
  const answer = snapshot.workflow!.answers.find((a) => a.id === answerId),
    presentation = snapshot.workflow!.shares.find(
      (share) => share.id === answerId,
    ),
    version = snapshot.versions.find(
      (v) => v.id === (answer?.versionId ?? presentation?.versionId),
    );
  if (!version) return <EmptyState title={t("workflow.receiptNotFound")} />;
  return (
    <Panel title={t("workflow.receiptTitle")}>
      <VersionDetails version={version} />
      <h3 className={`${appStyles["font-semibold"]} ${appStyles["mt-5"]}`}>{t("workflow.myAnswer")}</h3>
      {answer ? (
        <>
          <p>
            {workflowLabel(t, answer.kind)}：{workflowLabel(t, answer.response)}
          </p>
          <p>{answer.text}</p>
          <p className={uiStyles["ui-muted"]}>{t("workflow.answeredAt")}{formatDate(answer.at)}</p>
        </>
      ) : (
        <Alert>{t("workflow.receiptUnanswered")}</Alert>
      )}
      <div className={`${uiStyles["ui-actions"]} ${appStyles["mt-5"]}`}>
        <Button onClick={() => window.print()}>{t("workflow.printReceipt")}</Button>
        <Button
          variant="secondary"
          onClick={() =>
            downloadJson("my-receipt.json", { preview: true, version, answer })
          }
        >
          {t("workflow.getReceipt")}</Button>
      </div>
    </Panel>
  );
}

export function TasksScreen() {
  const { t } = useI18n();
  const { snapshot, base } = useWorkspace();
  const tasks = [
    ...snapshot
      .workflow!.disputes.filter((d) => d.status !== "解決")
      .map((d) => ({
        id: d.id,
        title: d.text,
        status: d.status,
        kind: t("workflow.disputeTask"),
        href: `cases/${d.caseId}/disputes`,
      })),
    ...Object.entries(snapshot.workflow!.registration)
      .filter(([, status]) => status !== "登録済み")
      .map(([id, status]) => ({
        id,
        title: t("workflow.registrationTask"),
        status,
        kind: t("workflow.verificationTask"),
        href: `cases/${snapshot.versions.find((v) => v.id === id)?.case_id}/verification?version=${id}`,
      })),
    ...snapshot
      .workflow!.management.filter(
        (m) => m.kind === "confirmation" && m.status === "未回答",
      )
      .map((m) => ({
        id: m.id,
        title: t("workflow.requestTask", { name: m.name }),
        status: m.status,
        kind: t("workflow.answer"),
        href: `cases/${snapshot.versions.find((v) => m.detail.startsWith(v.id))?.case_id}/answers`,
      })),
  ];
  const page = useClientPage(tasks, "taskPage");
  return (
    <Panel title={t("workflow.openTasks")}>
      {tasks.length ? (
        <table className={`${uiStyles["ui-table"]} ${uiStyles["ui-table--responsive"]}`}>
          <thead>
            <tr>
              <th>{t("workflow.content")}</th>
              <th>{t("workflow.type")}</th>
              <th>{t("workflow.status")}</th>
              <th>{t("workflow.assigneeDeadline")}</th>
            </tr>
          </thead>
          <tbody>
            {page.data.map((task) => (
              <tr key={task.id}>
                <td data-label={t("workflow.content")}>
                  <Link to={`${base}/${task.href}`}>{task.title}</Link>
                </td>
                <td data-label={t("workflow.type")}>{workflowLabel(t, task.kind)}</td>
                <td data-label={t("workflow.status")}>
                  <Badge tone="warning">{workflowLabel(t, task.status)}</Badge>
                </td>
                <td data-label={t("workflow.assigneeDeadline")}>{t("workflow.sampleAssignee")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState title={t("workflow.noTasks")} />
      )}<Pagination pagination={page.pagination} pageKey="taskPage" />
    </Panel>
  );
}

export function VehicleHistoryScreen({ vehicleId }: { vehicleId: string }) {
  const { t, formatDate } = useI18n();
  const { snapshot } = useWorkspace();
  const vehicle = snapshot.vehicles.find((v) => v.id === vehicleId);
  const identifiers = useClientPage(vehicle?.identifiers ?? [], "identifierPage");
  const owners = useClientPage(snapshot.workflow!.management.filter(m => m.kind === `owner:${vehicleId}`), "ownerPage");
  if (!vehicle) return <EmptyState title={t("workflow.vehicleNotFound")} />;
  return (
    <>
      <Panel title={t("workflow.identifierHistory")}>
        <p className={uiStyles["ui-muted"]}>{t("workflow.internalIdPrefix")}{vehicle.id}</p>
        <table className={`${uiStyles["ui-table"]} ${uiStyles["ui-table--responsive"]}`}>
          <thead>
            <tr>
              <th>{t("workflow.identifier")}</th>
              <th>{t("workflow.start")}</th>
              <th>{t("workflow.end")}</th>
              <th>{t("workflow.confirmation")}</th>
            </tr>
          </thead>
          <tbody>
            {identifiers.data.map((i) => (
              <tr key={i.id}>
                <td data-label={t("workflow.identifier")}>
                  {workflowLabel(t, i.kind)}：{i.value}
                </td>
                <td data-label={t("workflow.start")}>{formatDate(i.valid_from)}</td>
                <td data-label={t("workflow.end")}>{formatDate(i.valid_to)}</td>
                <td data-label={t("workflow.confirmation")}>
                  {i.verified_at ? t("workflow.verified") : t("workflow.unverified")}
                </td>
              </tr>
            ))}
          </tbody>
        </table><Pagination pagination={identifiers.pagination} pageKey="identifierPage" />
      </Panel>
      {canManage(snapshot.context) && (
        <>
          <Panel title={t("workflow.changeIdentifier")}>
            <CommandForm intent="updateIdentifier" hidden={{ vehicleId }}>
              <Field id="history-kind" label={t("workflow.kind")}>
                <Select id="history-kind" name="kind">
                  <option value="plate_number">{t("workflow.plate")}</option>
                  <option value="chassis_number">{t("workflow.chassis")}</option>
                  <option value="vin">VIN</option>
                </Select>
              </Field>
              <TextField
                id="history-value"
                name="identifier"
                label={t("workflow.newIdentifier")}
                required
              />
              <CommandSubmit>{t("workflow.saveIdentifier")}</CommandSubmit>
            </CommandForm>
          </Panel>
          <Panel title={t("workflow.changeOwner")}>
            <CommandForm
              intent="manage"
              hidden={{ kind: `owner:${vehicleId}`, status: "確認待ち" }}
            >
              <TextField
                id="owner-name"
                name="name"
                label={t("workflow.newOwner")}
                required
              />
              <TextField
                id="owner-period"
                name="detail"
                label={t("workflow.ownerEvidence")}
                required
              />
              <Alert>
                {t("workflow.ownerPrivacy")}</Alert>
              <CommandSubmit>{t("workflow.requestOwner")}</CommandSubmit>
            </CommandForm>
            {owners.data.map((m) => (
                <p key={m.id}>
                  {m.name} / {m.detail} / {workflowLabel(t, m.status)}
                </p>
              ))}
          </Panel>
          <Pagination pagination={owners.pagination} pageKey="ownerPage" />
          <Panel title={t("workflow.duplicateCheck")}>
            <CommandForm intent="mergeVehicle" hidden={{ vehicleId }}>
              <TextField
                id="candidate"
                name="candidate"
                label={t("workflow.candidateId")}
                required
              />
              <TextField
                id="merge-reason"
                name="reason"
                label={t("workflow.matchReason")}
                required
              />
              <CommandSubmit>{t("workflow.requestMatch")}</CommandSubmit>
            </CommandForm>
          </Panel>
        </>
      )}
      <Panel title={t("workflow.photoGuide")}>
        <p className={uiStyles["ui-muted"]}>
          <Camera size={16} className={appStyles["inline"]} aria-hidden="true" />{" "}
          {t("workflow.photoGuideText")}</p>
      </Panel>
    </>
  );
}
