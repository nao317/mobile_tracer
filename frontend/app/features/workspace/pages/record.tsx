import { CoreBackLink } from "./navigation";
import { workflowLabel } from "../workflow-labels";
import appStyles from "../../../app.module.css";
import workspaceStyles from "../workspace.module.css";
import uiStyles from "../../../components/ui/ui.module.css";
import { useCoreI18n } from "./core-messages";

import { useSearchParams } from "react-router";
import { CoreLink as Link } from "./navigation";

import { Alert, Badge, EmptyState, Panel } from "../../../components/ui/primitives";
import { canWrite, type BusinessCase } from "../model";

import { useWorkspace } from "../workspace-context";

import { selectedVersion } from "./shared";
import { VersionDetails } from "./shared";
export function RecordScreen({
  item,
  recordId,
}: {
  item: BusinessCase;
  recordId: string;
}) {
  const { c, t } = useCoreI18n();

  const { snapshot, base } = useWorkspace();
  const [search] = useSearchParams();
  const version = snapshot.selectedVersion ?? selectedVersion(
    snapshot.versions.filter(v => v.case_id === item.id),
    recordId,
    search.get("version"),
  );
  if (!version || version.record_id !== recordId || version.case_id !== item.id) return <EmptyState title={c("workspace.record.missing")} />;
  const path = `${base}/cases/${item.id}/records/${recordId}`;
  const answers =
    snapshot.workflow?.answers.filter((a) => a.versionId === version.id) ?? [];
  return (
    <><CoreBackLink to={`${base}/cases/${item.id}/records`} />
      <Panel
        title={c("workspace.record.content")}
        actions={
          canWrite(snapshot.context, item) && (version.status === "draft" || snapshot.workflow) && (
            <Link
              className={uiStyles["ui-link-button"]}
              to={`${path}/${version.status === "draft" ? "edit" : "correct"}?version=${version.id}`}
            >
              {version.status === "draft" ? c("workspace.record.editDraft") : c("workspace.record.correction")}
            </Link>
          )
        }
      >
        <VersionDetails version={version} />
        <div className={[workspaceStyles["workspace-statuses"], appStyles["mt-5"]].join(" ")}>
          <div>
            <small>{c("workspace.record.responses")}</small>
            <Badge tone="warning">
              {!snapshot.workflow
                ? c("workspace.record.unavailable")
                : answers.length
                  ? answers.map((a) => `${workflowLabel(t, a.kind)}: ${workflowLabel(t, a.response)}`).join(" / ")
                  : c("workspace.record.unanswered")}
            </Badge>
          </div>
          <div>
            <small>{c("workspace.record.registration")}</small>
            <Badge>
              {snapshot.workflow
                ? workflowLabel(t, snapshot.workflow.registration[version.id] ?? "未登録")
                : c("workspace.record.unavailable")}
            </Badge>
          </div>
          <div>
            <small>{c("workspace.record.verification")}</small>
            <Badge>
              {snapshot.workflow
                ? workflowLabel(t, snapshot.workflow.verification[version.id] ?? "未実施")
                : c("workspace.record.unavailable")}
            </Badge>
          </div>
        </div>
        {version.change_reason && (
          <Alert>{c("workspace.record.correctionReasonPrefix")}{version.change_reason}</Alert>
        )}
      </Panel>
      {!snapshot.workflow && <Panel title="写真・顧客承認・チェーン登録"><a className={uiStyles["ui-link-button"]} href={`/transactions/${version.id}/photos`}>取引の確認画面を開く</a></Panel>}
      {snapshot.workflow && <Panel title={c("workspace.record.photosSubmission")}>
        <div className={uiStyles["ui-actions"]}>
          <Link
            className={uiStyles["ui-text-link"]}
            to={`${path}/photos?version=${version.id}`}
          >
            {c("workspace.record.photos")}</Link>
          {version.status === "draft" && canWrite(snapshot.context, item) && (
            <Link
              className={uiStyles["ui-link-button"]}
              to={`${path}/submit?version=${version.id}`}
            >
              {c("workspace.record.reviewSubmission")}</Link>
          )}
        </div>
      </Panel>}
    </>
  );
}
