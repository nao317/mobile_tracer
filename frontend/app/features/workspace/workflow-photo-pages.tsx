import appStyles from "../../app.module.css";
import uiStyles from "../../components/ui/ui.module.css";
import workspaceStyles from "./workspace.module.css";
import { workflowLabel } from "./workflow-labels";

import { useSearchParams } from "react-router";

import { EmptyState, Field, Panel, Select, TextField } from "../../components/ui/primitives";
import { canManage, canWrite, type BusinessCase } from "./model";
import { CommandForm, CommandSubmit } from "./command-form";
import { photoPositions } from "./preview-data";

import { useWorkspace } from "./workspace-context";

import { Pagination } from "../../components/molecules/pagination";
import { WorkflowViews, useClientPage } from "./workflow-navigation";
import { useI18n } from "../../components/ui/display-settings";
import { useCaseVersion, VersionPicker, PhotoCard } from "./workflow-common";
export function PhotosScreen({
  item,
  recordId,
}: {
  item: BusinessCase;
  recordId: string;
}) {
  const { t } = useI18n();
  const { snapshot } = useWorkspace();
  const { versions, version } = useCaseVersion(item, recordId);
  const [search] = useSearchParams();
  const view = search.get("view") || "overview";
  const positions = useClientPage(photoPositions[item.case_type], "photoPage");
  if (!version) return <EmptyState title={t("workflow.versionNotFound")} />;
  const photos = snapshot.workflow!.photos.filter(
      (p) => p.versionId === version.id,
    ),
    editable = version.status === "draft" && canWrite(snapshot.context, item);
  return (
    <>
      <WorkflowViews selected={view} items={[{ view: "overview", label: "workflow.nav.overview" }, { view: "capture", label: "workflow.nav.capture" }, { view: "exception", label: "workflow.nav.exception" }, { view: "retry", label: "workflow.nav.retry" }]} />
      <Panel title={t("workflow.photos")}>
        <VersionPicker versions={versions} selected={version} />
        <p className={`${uiStyles["ui-muted"]} ${appStyles["mt-4"]}`}>
          {t("workflow.photoInstructions")}</p>
        {view === "overview" && <><div className={`${uiStyles["ui-grid"]} ${appStyles["mt-5"]}`}>
          {positions.data.map((position) => (
            <PhotoCard
              key={position}
              position={position}
              photo={photos.find((p) => p.position === position)}
            />
          ))}
        </div><Pagination pagination={positions.pagination} pageKey="photoPage" /></>}
      </Panel>
      {editable && ["capture", "exception", "retry"].includes(view) && (
        <Panel title={t("workflow.addPhoto")}>
          <CommandForm
            intent="photo"
            hidden={{ caseId: item.id, recordId, versionId: version.id }}
          >
            <Field id="photo-position" label={t("workflow.photoPosition")}>
              <Select id="photo-position" name="position" defaultValue={search.get("position") ?? undefined}>
                {photoPositions[item.case_type].map((p) => (
                  <option key={p} value={p}>{workflowLabel(t, p)}</option>
                ))}
              </Select>
            </Field>
            <Field
              id="photo"
              label={t("workflow.originalPhoto")}
              hint={t("workflow.photoFileHint")}
            >
              <input
                id="photo"
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className={uiStyles["ui-input"]}
              />
            </Field>
            <TextField
              id="photo-note"
              name="note"
              label={t("workflow.photoNote")}
              maxLength={2000}
            />
            {view === "exception" && canManage(snapshot.context, item.store_id) && (
              <label className={workspaceStyles["workspace-check"]}>
                <input type="checkbox" name="exception" value="1" />
                {t("workflow.approveException")}</label>
            )}
            <label className={workspaceStyles["workspace-check"]}>
              <input type="checkbox" name="simulateFailure" value="1" />
              {t("workflow.simulateFailure")}</label>
            <CommandSubmit>{t("workflow.savePhoto")}</CommandSubmit>
          </CommandForm>
        </Panel>
      )}
    </>
  );
}
