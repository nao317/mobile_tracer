import uiStyles from "../../components/ui/ui.module.css";
import workspaceStyles from "./workspace.module.css";
import { workflowLabel } from "./workflow-labels";

import { Link, useSearchParams } from "react-router";

import { Alert, Badge, EmptyState, Field, Panel, Select, TextField } from "../../components/ui/primitives";
import { canManage, type BusinessCase } from "./model";
import { CommandForm, CommandSubmit } from "./command-form";


import { useWorkspace } from "./workspace-context";

import { Pagination } from "../../components/molecules/pagination";
import { WorkflowViews, WorkflowLink, useClientPage } from "./workflow-navigation";
import { useI18n } from "../../components/ui/display-settings";
import { useCaseVersion, VersionPicker, PhotoCard } from "./workflow-common";
export function SharingScreen({ item }: { item: BusinessCase }) {
  const { t, formatDate } = useI18n();
  const { snapshot, base } = useWorkspace();
  const { versions, version } = useCaseVersion(item);
  const [search] = useSearchParams();
  const view = search.get("view") || "list";
  const allShares = snapshot.workflow!.shares.filter(share => snapshot.versions.some(v => v.id === share.versionId && v.case_id === item.id));
  const shares = useClientPage(allShares, "sharePage");
  const photos = useClientPage(snapshot.workflow!.photos.filter(photo => photo.versionId === version?.id), "photoPage");
  const selected = allShares.find(share => share.id === search.get("item"));
  return (
    <>
      <WorkflowViews selected={view} items={[{ view: "list", label: "workflow.nav.list" }, { view: "new", label: "workflow.nav.new" }, { view: "review", label: "workflow.nav.review" }]} />
      <Panel title={t("workflow.shareTarget")}>
        <VersionPicker
          versions={versions.filter((v) => v.status === "submitted")}
          selected={version?.status === "submitted" ? version : undefined}
        />
        {view === "new" && version?.status === "submitted" &&
          canManage(snapshot.context, item.store_id) && (
            <CommandForm
              intent="share"
              hidden={{ caseId: item.id, versionId: version.id }}
            >
              <TextField
                id="recipient"
                name="recipient"
                label={t("workflow.shareRecipient")}
                required
              />
              <TextField
                id="expires"
                name="expires"
                type="datetime-local"
                label={t("workflow.shareExpiry")}
                required
              />
              <Field id="scope" label={t("workflow.shareScope")}>
                <Select id="scope" name="scope">
                  <option value="状態記録・写真（個人情報を除く）">{t("workflow.scopePhotos")}</option>
                  <option value="状態記録のみ（個人情報を除く）">{t("workflow.scopeRecords")}</option>
                </Select>
              </Field>
              <Alert>
                {t("workflow.sharePrivacy")}</Alert>
              <label className={workspaceStyles["workspace-check"]}>
                <input type="checkbox" required />
                {t("workflow.confirmShare")}</label>
              <CommandSubmit>{t("workflow.createShare")}</CommandSubmit>
            </CommandForm>
          )}
      </Panel>
      {view === "review" && version?.status === "submitted" &&
        canManage(snapshot.context, item.store_id) && (
          <Panel title={t("workflow.reviewPhotos")}>
            <p className={uiStyles["ui-muted"]}>
              {t("workflow.maskNotice")}</p>
            <div className={uiStyles["ui-grid"]}>
              {photos.data.map((photo) => (
                  <div className={uiStyles["ui-stack"]} key={photo.id}>
                    <PhotoCard photo={photo} position={photo.position} />
                    <CommandForm
                      intent="maskPhoto"
                      hidden={{
                        caseId: item.id,
                        versionId: version.id,
                        photoId: photo.id,
                      }}
                    >
                      <label className={workspaceStyles["workspace-check"]}>
                        <input
                          type="checkbox"
                          name="masked"
                          value="1"
                          defaultChecked={
                            snapshot.workflow!.publicMasks?.[photo.id] ?? false
                          }
                        />
                        {t("workflow.maskPhoto")}</label>
                      <CommandSubmit>{t("workflow.saveMask")}</CommandSubmit>
                    </CommandForm>
                  </div>
                ))}
            </div><Pagination pagination={photos.pagination} pageKey="photoPage" />
          </Panel>
        )}
{(view === "list" || view === "revoke") && (      <Panel title={t("workflow.shareHistory")}>
        <div className={uiStyles["ui-stack"]}>
          {(view === "revoke" ? (selected ? [selected] : []) : shares.data)            .map((s) => (
              <div key={s.id}>
                <strong>{s.recipient}</strong>{" "}
                <Badge tone={s.status === "active" ? "info" : "warning"}>
                  {s.status === "active"
                    ? t("workflow.sharing")
                    : s.status === "revoked"
                      ? t("workflow.shareRevoked")
                      : t("workflow.shareExpired")}
                </Badge>
                <p className={uiStyles["ui-muted"]}>
                  {workflowLabel(t, s.scope)} {t("workflow.expiryPrefix")}{formatDate(s.expires)}
                </p>
                <div className={uiStyles["ui-actions"]}>
                  <Link
                    className={uiStyles["ui-text-link"]}
                    to={`${base}/recipient/${s.id}`}
                  >
                    {t("workflow.previewRecipient")}</Link>
                  {view === "list" && s.status === "active" && canManage(snapshot.context, item.store_id) && <WorkflowLink view="revoke" item={s.id}>{t("workflow.revokeShare")}</WorkflowLink>}
                  {view === "revoke" && s.status === "active" &&
                    canManage(snapshot.context, item.store_id) && (
                      <details>
                        <summary>{t("workflow.revokeShare")}</summary>
                        <CommandForm
                          intent="revokeShare"
                          hidden={{ caseId: item.id, shareId: s.id }}
                        >
                          <label className={workspaceStyles["workspace-check"]}>
                            <input type="checkbox" required />
                            {t("workflow.revokeNotice")}</label>
                          <CommandSubmit variant="danger">
                            {t("workflow.revokeShare")}</CommandSubmit>
                        </CommandForm>
                      </details>
                    )}
                </div>
              </div>
            ))}
        </div>{view === "list" && <Pagination pagination={shares.pagination} pageKey="sharePage" />}
        {view === "revoke" && !selected && <EmptyState title={t("workflow.shareNotFound")} />}
      </Panel>)}
    </>
  );
}
