import appStyles from "../../app.module.css";
import uiStyles from "../../components/ui/ui.module.css";
import workspaceStyles from "./workspace.module.css";
import { workflowLabel } from "./workflow-labels";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { Alert, Badge, EmptyState, Field, Panel, Select, Textarea } from "../../components/ui/primitives";
import { canWrite, rulesFor, type BusinessCase } from "./model";
import { CommandForm, CommandSubmit } from "./command-form";
import { photoPositions } from "./preview-data";
import { VersionDetails } from "./core-screens";
import { useWorkspace } from "./workspace-context";

import { Pagination } from "../../components/molecules/pagination";
import { useClientPage } from "./workflow-navigation";
import { useI18n } from "../../components/ui/display-settings";
import { useCaseVersion, VersionPicker, PhotoCard } from "./workflow-common";
export function SubmitScreen({
  item,
  recordId,
}: {
  item: BusinessCase;
  recordId: string;
}) {
  const { t, fieldLabel } = useI18n();
  const { snapshot, base } = useWorkspace();
  const { version } = useCaseVersion(item, recordId);
  const record = snapshot.records.find((r) => r.id === recordId);
  if (!version || !record) return <EmptyState title={t("workflow.versionNotFound")} />;
  const required = Object.entries(
    rulesFor(snapshot, item)?.record_kinds[record.record_kind]?.fields ?? {},
  ).filter(([, rule]) => rule.required);
  const missing = required.filter(
    ([key]) =>
      version.entries[key] === undefined ||
      version.entries[key] === null ||
      version.entries[key] === "",
  );
  const photos = snapshot.workflow!.photos.filter(
    (p) => p.versionId === version.id,
  );
  const photoMissing = photoPositions[item.case_type].filter(
    (position) =>
      !photos.some((p) => p.position === position && p.status !== "failed"),
  );
  return (
    <>
      <Panel title={t("workflow.submitReview")}>
        <VersionDetails version={version} />
        <div className={`${uiStyles["ui-stack"]} ${appStyles["mt-5"]}`}>
          <div className={uiStyles["ui-actions"]}>
            {missing.length || photoMissing.length ? (
              <CircleAlert size={18} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={18} aria-hidden="true" />
            )}
            <strong>
              {missing.length || photoMissing.length
                ? t("workflow.missingSubmission")
                : t("workflow.readySubmission")}
            </strong>
          </div>
          {missing.length > 0 && (
            <Alert tone="danger">
              {t("workflow.missingFields")}{missing.map(([key]) => fieldLabel(key)).join("、")}
            </Alert>
          )}
          {photoMissing.length > 0 && (
            <Alert tone="danger">
              {t("workflow.missingPhotos")}{photoMissing.map(position => workflowLabel(t, position)).join(", ")}
            </Alert>
          )}
          <p className={uiStyles["ui-muted"]}>
            {t("workflow.submitNotice")}</p>
        </div>
      </Panel>
      {version.status === "draft" && canWrite(snapshot.context, item) ? (
        <Panel title={t("workflow.submit")}>
          <CommandForm
            intent="submitRecord"
            hidden={{ caseId: item.id, recordId, versionId: version.id }}
          >
            <label className={workspaceStyles["workspace-check"]}>
              <input type="checkbox" required />
              {t("workflow.confirmSubmission")}</label>
            <CommandSubmit>{t("workflow.submitVersion")}</CommandSubmit>
          </CommandForm>
        </Panel>
      ) : (
        <Alert>{t("workflow.submittedOrDenied")}</Alert>
      )}
      <Link
        className={uiStyles["ui-text-link"]}
        to={`${base}/cases/${item.id}/records/${recordId}/edit?version=${version.id}`}
      >
        {t("workflow.reviewDraft")}</Link>
    </>
  );
}
export function CorrectScreen({
  item,
  recordId,
}: {
  item: BusinessCase;
  recordId: string;
}) {
  const { t } = useI18n();
  const { snapshot } = useWorkspace();
  const { versions, version } = useCaseVersion(item, recordId);
  return (
    <>
      <Panel title={t("workflow.originalVersion")}>
        <VersionPicker
          versions={versions.filter((v) => v.status === "submitted")}
          selected={version?.status === "submitted" ? version : undefined}
        />
        {version?.status === "submitted" && (
          <div className={appStyles["mt-5"]}>
            <VersionDetails version={version} />
          </div>
        )}
      </Panel>
      {version?.status === "submitted" && canWrite(snapshot.context, item) && (
        <Panel title={t("workflow.newCorrection")}>
          <CommandForm
            intent="correctRecord"
            hidden={{ caseId: item.id, recordId, versionId: version.id }}
          >
            <Field id="change_kind" label={t("workflow.changeKind")}>
              <Select id="change_kind" name="change_kind">
                <option value="correction">{t("workflow.correction")}</option>
                <option value="supplement">{t("workflow.supplement")}</option>
              </Select>
            </Field>
            <Field id="change-reason" label={t("workflow.changeReason")}>
              <Textarea
                id="change-reason"
                name="reason"
                required
                maxLength={2000}
              />
            </Field>
            <Alert>
              {t("workflow.correctionNotice")}</Alert>
            <CommandSubmit>{t("workflow.createDraft")}</CommandSubmit>
          </CommandForm>
        </Panel>
      )}
    </>
  );
}
export function CompareScreen({ item }: { item: BusinessCase }) {
  const { t, fieldLabel } = useI18n();
  const { snapshot } = useWorkspace();
  const [search] = useSearchParams();
  const judgments = useClientPage(snapshot.workflow!.management.filter(m => m.kind === "comparison"), "judgmentPage");
  const versions = snapshot.versions.filter((v) => v.case_id === item.id),
    before = versions.find((v) => v.id === search.get("before")) ?? versions[0],
    after = versions.find((v) => v.id === search.get("after")) ?? versions[1];
  const fields = [
    ...new Set([
      ...Object.keys(before?.entries ?? {}),
      ...Object.keys(after?.entries ?? {}),
    ]),
  ];
  return (
    <>
      <Panel title={t("workflow.compareVersions")}>
        <div className={uiStyles["ui-grid"]}>
          <VersionPicker
            name="before"
            label={t("workflow.compareBefore")}
            versions={versions}
            selected={before}
          />
          <VersionPicker
            name="after"
            label={t("workflow.compareAfter")}
            versions={versions}
            selected={after}
          />
        </div>
      </Panel>
      {!before || !after || before.id === after.id ? (
        <EmptyState title={t("workflow.selectDifferentVersions")}>
          {t("workflow.comparisonHint")}</EmptyState>
      ) : (
        <>
          <Panel title={t("workflow.compareFields")}>
            <table className={uiStyles["ui-table"]}>
              <thead>
                <tr>
                  <th>{t("workflow.field")}</th>
                  <th>
                    {t("workflow.beforeVersion")}{before.version_no}
                    <span className={workspaceStyles["workspace-table-subtitle"]}>
                      {before.record_id.slice(-6)} / {workflowLabel(t, before.status)}
                    </span>
                  </th>
                  <th>
                    {t("workflow.afterVersion")}{after.version_no}
                    <span className={workspaceStyles["workspace-table-subtitle"]}>
                      {after.record_id.slice(-6)} / {workflowLabel(t, after.status)}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {fields.map((key) => (
                  <tr key={key}>
                    <th scope="row">{fieldLabel(key)}</th>
                    <td>{String(before.entries[key] ?? t("workflow.notRecorded"))}</td>
                    <td>
                      {String(after.entries[key] ?? t("workflow.notRecorded"))}{" "}
                      {before.entries[key] !== after.entries[key] && (
                        <Badge tone="warning">{t("workflow.difference")}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title={t("workflow.comparePhotos")}>
            <div className={uiStyles["ui-stack"]}>
              {photoPositions[item.case_type].map((position) => {
                const a = snapshot.workflow!.photos.find(
                    (p) => p.versionId === before.id && p.position === position,
                  ),
                  b = snapshot.workflow!.photos.find(
                    (p) => p.versionId === after.id && p.position === position,
                  );
                return (
                  <section key={position}>
                    <h3 className={`${appStyles["font-semibold"]} ${appStyles["mb-3"]}`}>{workflowLabel(t, position)}</h3>
                    <div className={uiStyles["ui-grid"]}>
                      <PhotoCard photo={a} position={t("workflow.beforePhoto", { position: workflowLabel(t, position) })} />
                      <PhotoCard photo={b} position={t("workflow.afterPhoto", { position: workflowLabel(t, position) })} />
                    </div>
                    {(!a ||
                      !b ||
                      a.status !== "saved" ||
                      b.status !== "saved") && (
                      <Alert tone="warning">
                        {t("workflow.incomparablePhotos")}</Alert>
                    )}
                  </section>
                );
              })}
            </div>
          </Panel>
          {canWrite(snapshot.context, item) && (
            <Panel title={t("workflow.judgment")}>
              <CommandForm
                intent="manage"
                hidden={{
                  kind: "comparison",
                  name: `${before.id} → ${after.id}`,
                  status: "判定記録",
                }}
              >
                <Field id="comparison-detail" label={t("workflow.judgmentReason")}>
                  <Textarea id="comparison-detail" name="detail" required />
                </Field>
                <CommandSubmit>{t("workflow.saveJudgment")}</CommandSubmit>
              </CommandForm>
              {judgments.data.map((m) => (
                  <p key={m.id} className={`${uiStyles["ui-muted"]} ${appStyles["mt-4"]}`}>
                    {m.detail}
                  </p>
                ))}
            <Pagination pagination={judgments.pagination} pageKey="judgmentPage" /></Panel>
          )}
        </>
      )}
    </>
  );
}
