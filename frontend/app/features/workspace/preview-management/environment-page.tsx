import { Link } from "react-router";
import { useI18n } from "../../../components/ui/display-settings";
import { EmptyState, Field, Panel, Select, TextField } from "../../../components/ui/primitives";
import { CommandForm, CommandSubmit } from "../command-form";
import { businessTypes } from "../model";
import { useWorkspace } from "../workspace-context";
import { BackLink, ItemHistory, ManagementEditor, ManagementList, ViewLinks, styles, ui, useView } from "./common";

export function EnvironmentsScreen() {
  const { snapshot } = useWorkspace();
  const { t, enumLabel } = useI18n();
  const { view, search, href } = useView("list");
  const environments = snapshot.workflow!.management.filter((item) => item.kind === "environment");
  const selected = environments.find((item) => item.id === search.get("item"));
  const links = [
    { to: href("list"), label: t("previewManagement.environments") },
    { to: href("templates"), label: t("previewManagement.templates") },
    { to: href("new"), label: t("previewManagement.environmentCreate") },
  ];
  const persistedTemplate = (business: string) => businessTypes[business as keyof typeof businessTypes] ?? "三業態共通テンプレート";
  let content;
  if (view === "new") content = <Panel title={t("previewManagement.environmentCreate")}>
    <CommandForm intent="manage" hidden={{ kind: "environment", status: "顧客確認待ち" }} guard>
      <TextField id="environment-name" name="name" label={t("previewManagement.environmentName")} required />
      <Field id="environment-template" label={t("previewManagement.environmentTemplate")}><Select id="environment-template" name="detail" defaultValue={persistedTemplate(search.get("template") ?? "")}>
        <option value="三業態共通テンプレート">{t("previewManagement.allBusinesses")}</option>
        {Object.entries(businessTypes).map(([business, label]) => <option key={business} value={label}>{enumLabel("business", business)}</option>)}
      </Select></Field>
      <label className={styles["workspace-check"]}><input type="checkbox" required />{t("previewManagement.environmentConfirm")}</label>
      <CommandSubmit>{t("previewManagement.environmentCreate")}</CommandSubmit>
    </CommandForm>
  </Panel>;
  else if (view === "templates") content = <Panel title={t("previewManagement.templates")}>
    <div className={ui["ui-stack"]}>{["all", ...Object.keys(businessTypes)].map((business) => <article key={business}>
      <strong>{business === "all" ? t("previewManagement.allBusinesses") : enumLabel("business", business)}</strong>{" "}
      <Link className={ui["ui-text-link"]} to={`${href("new")}&template=${business}`}>{t("previewManagement.environmentCreate")}</Link>
    </article>)}</div>
  </Panel>;
  else if (view === "edit" || view === "history") content = selected ? <>
    <BackLink to={href("list")} />
    <ViewLinks selected={href(view, selected.id)} items={[
      { to: href("edit", selected.id), label: t("previewManagement.edit") },
      { to: href("history", selected.id), label: t("previewManagement.history") },
    ]} />
    {view === "history" ? <ItemHistory item={selected} /> : <ManagementEditor item={selected} actions={["試行中", "顧客確認待ち", "利用中", "作成失敗"]} />}
  </> : <EmptyState title={t("previewManagement.missing")} />;
  else content = <Panel title={t("previewManagement.environments")}><ManagementList items={environments} detailView="edit" /></Panel>;
  return <><ViewLinks items={links} selected={href(view)} />{content}</>;
}
