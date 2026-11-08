import type { StaticTranslationKey } from "../../../i18n";
import { executePreview } from "../preview-commands";
import { createPreviewData, demoId } from "../preview-data";
import type { WorkspaceData } from "../model";
import type { ScreenKey } from "../screens";

export type PreviewViewRoute = {
  id: string;
  screen: ScreenKey;
  to: string;
  labelKey: StaticTranslationKey;
  /** The creation view must be completed first when this kind has no sample. */
  requiresItem?: string;
};
/** Every query view, with real selected IDs from the supplied preview snapshot. */
export function previewViewRoutes(snapshot: WorkspaceData, base = "/preview"): PreviewViewRoute[] {
  const routes: PreviewViewRoute[] = [];
  const add = (screen: ScreenKey, path: string, view: string, labelKey: StaticTranslationKey, options: { kind?: string; item?: string; version?: string; id?: string } = {}) => {
    const item = options.item ?? (options.kind ? snapshot.workflow?.management.find((item) => item.kind === options.kind)?.id : undefined);
    const query = new URLSearchParams({ view });
    if (item) query.set("item", item);
    if (options.version) query.set("version", options.version);
    routes.push({ id: options.id ?? `${screen}:${view}`, screen, to: `${base}/${path}?${query}`, labelKey, ...(options.kind && !item ? { requiresItem: options.kind } : {}) });
  };
  const org = "settings/organization";
  add("organization", org, "stores", "previewManagement.stores");
  add("organization", org, "staff", "previewManagement.staff");
  add("organization", org, "stores-new", "previewManagement.addStore");
  add("organization", org, "staff-new", "previewManagement.inviteStaff");
  for (const [view, kind] of [["stores", "store"], ["staff", "staff"]]) {
    add("organization", org, `${view}-edit`, "previewManagement.edit", { kind });
    add("organization", org, `${view}-history`, "previewManagement.history", { kind });
  }
  for (const [view, label] of [["current", "previewManagement.current"], ["edit", "previewManagement.configurationEdit"], ["history", "previewManagement.history"]] as const)
    add("configuration", "settings/configuration", view, label);
  add("configuration", "settings/configuration", "preview", "previewManagement.configurationPreview", { kind: "configuration" });
  add("configuration", "settings/configuration", "history", "previewManagement.history", { kind: "configuration", id: "configuration:history-item" });
  for (const screen of ["support", "deletion"] as const) {
    const path = `settings/${screen}`;
    add(screen, path, "history", "previewManagement.history");
    add(screen, path, "new", "previewManagement.create");
    add(screen, path, "detail", "previewManagement.detail", { kind: screen });
    add(screen, path, "edit", "previewManagement.edit", { kind: screen });
  }
  for (const [view, label] of [["list", "previewManagement.environments"], ["templates", "previewManagement.templates"], ["new", "previewManagement.environmentCreate"]] as const)
    add("environments", "operations/environments", view, label);
  add("environments", "operations/environments", "edit", "previewManagement.edit", { kind: "environment" });
  add("environments", "operations/environments", "history", "previewManagement.history", { kind: "environment" });
  for (const [view, label] of [["history", "previewManagement.importHistory"], ["new", "previewManagement.importCreate"], ["preview", "previewManagement.csvResults"]] as const)
    add("imports", "operations/imports", view, label);
  add("imports", "operations/imports", "detail", "previewManagement.detail", { kind: "import" });
  for (const [view, label] of [["operations", "previewManagement.operations"], ["summary", "previewManagement.usage"], ["capacity", "previewManagement.capacity"]] as const)
    add("operations", "operations/status", view, label);
  add("usage", "settings/usage", "summary", "previewManagement.usage");
  add("usage", "settings/usage", "capacity", "previewManagement.capacity");
  add("audit", "settings/audit", "history", "previewManagement.audit");
  add("support-access", "operations/support", "permissions", "previewManagement.access");
  add("support-access", "operations/support", "detail", "previewManagement.detail", { kind: "support" });
  add("support-access", "operations/support", "record", "previewManagement.accessRecord", { kind: "support" });
  add("catalog", "screens", "screens", "previewManagement.catalog");
  add("catalog", "screens", "flows", "previewManagement.catalogFlows");

  const item = snapshot.cases[0];
  const submitted = snapshot.versions.find((version) => version.case_id === item?.id && version.status === "submitted");
  const draft = snapshot.versions.find((version) => version.case_id === item?.id && version.status === "draft");
  if (item && submitted) {
    const casePath = `cases/${item.id}`;
    for (const view of ["request", "new", "history"] as const)
      add("answers", `${casePath}/answers`, view, `workflow.nav.${view}`, { version: submitted.id });
    for (const view of ["list", "new"] as const)
      add("disputes", `${casePath}/disputes`, view, `workflow.nav.${view}`, { version: submitted.id });
    const dispute = snapshot.workflow?.disputes.find((entry) => entry.caseId === item.id);
    for (const view of ["detail", "history"] as const)
      add("disputes", `${casePath}/disputes`, view, view === "detail" ? "previewManagement.detail" : "previewManagement.history", { version: submitted.id, item: dispute?.id });
    for (const view of ["list", "new", "review"] as const)
      add("sharing", `${casePath}/sharing`, view, `workflow.nav.${view}`, { version: submitted.id });
    add("sharing", `${casePath}/sharing`, "revoke", "workflow.revokeShare", { version: submitted.id, item: snapshot.workflow?.shares.find((share) => share.versionId === submitted.id)?.id });
    for (const view of ["registration", "check", "history"] as const)
      add("verification", `${casePath}/verification`, view, `workflow.nav.${view}`, { version: submitted.id });
  }
  if (item && draft) for (const view of ["overview", "capture", "exception", "retry"] as const)
    add("photos", `cases/${item.id}/records/${draft.record_id}/photos`, view, `workflow.nav.${view}`, { version: draft.id });
  const vehicle = snapshot.vehicles[0];
  if (vehicle) add("vehicle", `vehicles/${vehicle.id}`, "edit", "previewManagement.edit");
  return routes;
}

/** A deterministic set of creation commands for browser/DOM review setup. */
export const previewManagementReviewCommands: Record<string, string>[] = [
  { intent: "previewConfiguration", name: "Review configuration", business: "rental", reason: "Review optional odometer" },
  { intent: "manage", kind: "deletion", name: "Review deletion request", detail: "Fictional record only", status: "承認待ち" },
  { intent: "manage", kind: "import", name: "車両CSVの取込", detail: "1件正常 / 0件除外", status: "確認済み・取込結果サンプル" },
];
/** Create representative item IDs without mutating or persisting the caller's data. */
export function createPreviewManagementReviewData(source = createPreviewData()): WorkspaceData {
  let snapshot = structuredClone(source);
  for (const [index, values] of previewManagementReviewCommands.entries()) {
    const kind = values.kind ?? "configuration";
    if (snapshot.workflow!.management.some((item) => item.kind === kind)) continue;
    const existing = new Set(snapshot.workflow!.management.map((item) => item.id));
    const form = new FormData();
    for (const [key, value] of Object.entries(values)) form.set(key, value);
    const outcome = executePreview(snapshot, form);
    if (outcome.result.error) throw new Error(outcome.result.code);
    snapshot = outcome.snapshot;
    const created = snapshot.workflow!.management.find((item) => !existing.has(item.id))!;
    const generatedId = created.id;
    const stableId = demoId(900 + index);
    created.id = stableId;
    created.history = created.history.map((entry) => entry.replaceAll(generatedId, stableId));
    snapshot.workflow!.audit[0].id = demoId(910 + index);
    for (const entry of snapshot.workflow!.audit)
      entry.target = entry.target.replaceAll(generatedId, stableId);
  }
  return snapshot;
}
