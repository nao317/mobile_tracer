import { useI18n } from "../../../components/ui/display-settings";
import { Pagination } from "../../../components/molecules/pagination";
import { Alert, Badge, EmptyState, Field, Panel, Select, TextField } from "../../../components/ui/primitives";
import { CommandForm, CommandSubmit } from "../command-form";
import { businessTypes, isTenantAdmin, settingsSchema, type ManagementItem } from "../model";
import { useWorkspace } from "../workspace-context";
import { BackLink, ItemHistory, ManagementList, ViewLinks, styles, ui, useClientPage, useManagementLabels, useView } from "./common";

function CurrentConfiguration() {
  const { snapshot } = useWorkspace();
  const { t, enumLabel, fieldLabel } = useI18n();
  const configuration = snapshot.context.configuration;
  const rows = Object.entries(configuration?.settings.businesses ?? {}).flatMap(([business, rule]) =>
    Object.entries(rule.record_kinds).flatMap(([kind, record]) =>
      Object.entries(record.fields).map(([field, definition]) => ({ business, kind, field, definition })),
    ),
  );
  const page = useClientPage(rows, "fieldsPage");
  return <Panel title={t("previewManagement.current")}>
    <p className={ui["ui-muted"]}>{t("previewManagement.configurationVersion", { id: configuration?.id ?? "—" })}</p>
    {Object.entries(configuration?.settings.businesses ?? {}).map(([business, rule]) => <p key={business}>
      <strong>{enumLabel("business", business)}</strong>{" "}
      {t("previewManagement.stages", { stages: rule.stages.map((stage) => enumLabel("stage", stage)).join(" → ") })}
    </p>)}
    <table className={`${ui["ui-table"]} ${ui["ui-table--responsive"]}`}><thead><tr>
      <th>{t("previewManagement.configurationBusiness")}</th><th>{t("previewManagement.detail")}</th><th>{t("previewManagement.fieldType")}</th><th>{t("previewManagement.required")}</th>
    </tr></thead><tbody>{page.items.map((row) => <tr key={`${row.business}:${row.kind}:${row.field}`}>
      <td data-label={t("previewManagement.configurationBusiness")}>{enumLabel("business", row.business)}</td>
      <td data-label={t("previewManagement.detail")}>{row.kind === "inspection" ? t("previewManagement.inspection") : row.kind} / {fieldLabel(row.field)}</td>
      <td data-label={t("previewManagement.fieldType")}>{t(`previewManagement.type.${row.definition.type}`)}</td>
      <td data-label={t("previewManagement.required")}>{t(row.definition.required ? "previewManagement.required" : "previewManagement.optional")}</td>
    </tr>)}</tbody></table>
    {!rows.length && <EmptyState title={t("previewManagement.empty")} />}
    <Pagination pagination={page.pagination} pageKey="fieldsPage" />
  </Panel>;
}
function trialSettings(item: ManagementItem) {
  let json: unknown;
  try { json = JSON.parse(item.detail); } catch { json = null; }
  return settingsSchema.safeParse(json);
}
function ConfigurationChanges({ item }: { item: ManagementItem }) {
  const { snapshot } = useWorkspace();
  const { t, fieldLabel, enumLabel } = useI18n();
  const proposed = trialSettings(item);
  const current = snapshot.context.configuration?.settings;
  const changes = proposed.success ? Object.entries(proposed.data.businesses).flatMap(([business, rules]) =>
    Object.entries(rules.record_kinds).flatMap(([kind, record]) =>
      Object.entries(record.fields).flatMap(([field, rule]) => {
        const before = current?.businesses[business]?.record_kinds[kind]?.fields[field]?.required ?? false;
        const after = rule.required ?? false;
        return before === after ? [] : [{ business, kind, field, before, after }];
      }),
    ),
  ) : [];
  const page = useClientPage(changes, "changesPage");
  if (!proposed.success) return <Alert tone="danger">{t("previewManagement.invalidConfiguration")}</Alert>;
  return <Panel title={t("previewManagement.changes")}>
    {page.items.length ? <table className={`${ui["ui-table"]} ${ui["ui-table--responsive"]}`}><thead><tr>
      <th>{t("previewManagement.detail")}</th><th>{t("previewManagement.before")}</th><th>{t("previewManagement.after")}</th>
    </tr></thead><tbody>{page.items.map((change) => <tr key={`${change.business}:${change.kind}:${change.field}`}>
      <td data-label={t("previewManagement.detail")}>{enumLabel("business", change.business)} / {fieldLabel(change.field)}</td>
      <td data-label={t("previewManagement.before")}>{t(change.before ? "previewManagement.required" : "previewManagement.optional")}</td>
      <td data-label={t("previewManagement.after")}>{t(change.after ? "previewManagement.required" : "previewManagement.optional")}</td>
    </tr>)}</tbody></table> : <p>{t("previewManagement.noChanges")}</p>}
    <Pagination pagination={page.pagination} pageKey="changesPage" />
  </Panel>;
}
function ConfigurationEditor() {
  const { snapshot } = useWorkspace();
  const { t, enumLabel } = useI18n();
  if (!isTenantAdmin(snapshot.context)) return <EmptyState title={t("previewManagement.forbidden")} />;
  return <Panel title={t("previewManagement.configurationEdit")}>
    <CommandForm intent="previewConfiguration" guard>
      <TextField id="config-name" name="name" label={t("previewManagement.configurationName")} required />
      <Field id="config-business" label={t("previewManagement.configurationBusiness")}><Select id="config-business" name="business">
        {Object.keys(businessTypes).map((business) => <option key={business} value={business}>{enumLabel("business", business)}</option>)}
      </Select></Field>
      <label className={styles["workspace-check"]}><input type="checkbox" name="required_odometer" value="1" defaultChecked />{t("previewManagement.odometerRequired")}</label>
      <TextField id="config-reason" name="reason" label={t("previewManagement.changeReason")} required />
      <Alert>{t("previewManagement.configurationNotice")}</Alert>
      <CommandSubmit>{t("previewManagement.trial")}</CommandSubmit>
    </CommandForm>
  </Panel>;
}
export function ConfigurationScreen() {
  const { snapshot } = useWorkspace();
  const { t } = useI18n();
  const { view, search, href } = useView("current");
  const labels = useManagementLabels();
  const configurations = snapshot.workflow!.management.filter((item) => item.kind === "configuration");
  const selected = search.has("item")
    ? configurations.find((item) => item.id === search.get("item"))
    : configurations.at(-1);
  const links = [
    { to: href("current"), label: t("previewManagement.current") },
    ...(isTenantAdmin(snapshot.context) ? [{ to: href("edit"), label: t("previewManagement.configurationEdit") }] : []),
    { to: href("preview"), label: t("previewManagement.configurationPreview") },
    { to: href("history"), label: t("previewManagement.history") },
  ];
  let content;
  if (view === "edit") content = <ConfigurationEditor />;
  else if (view === "history") content = search.has("item") && selected
    ? <><BackLink to={href("history")} /><ItemHistory item={selected} /></>
    : <Panel title={t("previewManagement.configurationHistory")}><ManagementList items={configurations} detailView="preview" /></Panel>;
  else if (view === "preview") content = selected ? <>
    <Panel title={t("previewManagement.configurationPreview")}>
      <p>{selected.name} <Badge>{labels.status(selected.status)}</Badge></p>
      <BackLink to={href("history", selected.id)} />
    </Panel>
    <ConfigurationChanges item={selected} />
    {isTenantAdmin(snapshot.context) && selected.status === "試行済み" && trialSettings(selected).success && <Panel title={t("previewManagement.apply")}>
      <CommandForm intent="applyConfiguration" hidden={{ managementId: selected.id }}>
        <Alert>{t("previewManagement.configurationNotice")}</Alert>
        <label className={styles["workspace-check"]}><input type="checkbox" required />{t("previewManagement.applyConfirm")}</label>
        <CommandSubmit>{t("previewManagement.apply")}</CommandSubmit>
      </CommandForm>
    </Panel>}
  </> : <EmptyState title={t("previewManagement.noTrial")} />;
  else content = <CurrentConfiguration />;
  return <><ViewLinks items={links} selected={href(view)} />{content}</>;
}
