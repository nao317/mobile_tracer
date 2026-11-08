import appStyles from "../../app.module.css";
import uiStyles from "../../components/ui/ui.module.css";
import workspaceStyles from "./workspace.module.css";
import { workflowLabel } from "./workflow-labels";
import { CarFront } from "lucide-react";
import { useSearchParams } from "react-router";

import { Badge, Field, Select } from "../../components/ui/primitives";
import { type BusinessCase, type Photo, type Version } from "./model";



import { useWorkspace } from "./workspace-context";

import { Pagination } from "../../components/molecules/pagination";
import { useClientPage } from "./workflow-navigation";
import { useI18n } from "../../components/ui/display-settings";
export function useCaseVersion(item: BusinessCase, recordId?: string) {
  const { snapshot } = useWorkspace();
  const [search] = useSearchParams();
  const available = snapshot.selectedVersion && !snapshot.versions.some(version => version.id === snapshot.selectedVersion!.id) ? [snapshot.selectedVersion, ...snapshot.versions] : snapshot.versions;
  const versions = available
    .filter(
      (v) => v.case_id === item.id && (!recordId || v.record_id === recordId),
    )
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.version_no - a.version_no,
    );
  const id = search.get("version");
  const version = id
    ? versions.find((v) => v.id === id)
    : (versions.find((v) => v.status === "draft") ?? versions[0]);
  return { versions, version };
}
export function VersionPicker({
  versions,
  selected,
  name = "version",
  label,
}: {
  versions: Version[];
  selected?: Version;
  name?: string;
  label?: string;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useSearchParams();
  const options = useClientPage(versions, `${name}Page`);
  const visible = selected && !options.data.some(version => version.id === selected.id) ? [selected, ...options.data] : options.data;
  return (
    <div><Field id={`select-${name}`} label={label ?? t("workflow.versionTarget")}>
      <Select
        id={`select-${name}`}
        value={selected?.id ?? ""}
        onChange={(event) => {
          const next = new URLSearchParams(search);
          next.set(name, event.target.value);
          setSearch(next);
        }}
      >
        <option value="" disabled>
          {t("workflow.selectVersion")}</option>
        {visible.map((v) => (
          <option key={v.id} value={v.id}>
            {v.record_id.slice(-6)} / v{v.version_no} /{" "}
            {v.status === "submitted" ? t("workflow.submitted") : t("workflow.draft")}
          </option>
        ))}
      </Select>
    </Field><Pagination pagination={options.pagination} pageKey={`${name}Page`} /></div>
  );
}
export function PhotoCard({
  photo,
  position,
  variant = "internal",
}: {
  photo?: Photo;
  position: string;
  variant?: "internal" | "public";
}) {
  const { t, formatDate } = useI18n();
  const { snapshot } = useWorkspace();
  const masked =
    variant === "public" &&
    !!photo &&
    snapshot.workflow?.publicMasks?.[photo.id];
  return (
    <article className={workspaceStyles["workspace-photo"]}>
      <div className={workspaceStyles["workspace-photo-visual"]}>
        {masked ? (
          <span>{t("workflow.maskedPhoto")}</span>
        ) : photo?.src ? (
          <img
            src={photo.src}
            alt={t("workflow.photoAlt", { position: workflowLabel(t, position) })}
            width={640}
            height={480}
            className={`${appStyles["w-full"]} ${appStyles["h-40"]} ${appStyles["object-cover"]}`}
            loading="lazy"
          />
        ) : (
          <CarFront aria-hidden="true" />
        )}
      </div>
      <div className={workspaceStyles["workspace-photo-caption"]}>
        <div className={uiStyles["ui-actions"]}>
          <strong>{workflowLabel(t, position)}</strong>
          <Badge
            tone={
              !photo || photo.status === "failed"
                ? "danger"
                : photo.status === "exception"
                  ? "warning"
                  : "success"
            }
          >
            {!photo
              ? t("workflow.notCaptured")
              : photo.status === "failed"
                ? t("workflow.uploadFailed")
                : photo.status === "exception"
                  ? t("workflow.exceptionApproved")
                  : t("workflow.saved")}
          </Badge>
        </div>
        <p>{photo?.note || t("workflow.photoHint")}</p>
        {photo && variant === "internal" && (
          <details>
            <summary>{t("workflow.photoMetadata")}</summary>
            <p>{photo.name}</p>
            <p>{t("workflow.receivedAt")}{formatDate(photo.receivedAt)}</p>
            <p>{t("workflow.captureDateUnknown")}</p>
            {photo.src && (
              <a
                className={uiStyles["ui-text-link"]}
                href={photo.src}
                target="_blank"
                rel="noreferrer"
              >
                {t("workflow.openOriginal")}</a>
            )}
            {photo.status === "exception" && <p>{t("workflow.sampleApprover")}</p>}
          </details>
        )}
      </div>
    </article>
  );
}
