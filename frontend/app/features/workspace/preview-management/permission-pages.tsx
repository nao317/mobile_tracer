import { useI18n } from "../../../components/ui/display-settings";
import { Alert, EmptyState, Field, Panel, TextField, Textarea } from "../../../components/ui/primitives";
import { CommandForm, CommandSubmit } from "../command-form";
import { isTenantAdmin } from "../model";
import { useWorkspace } from "../workspace-context";
import { BackLink, ItemHistory, ManagementEditor, ManagementList, ViewLinks, styles, useView } from "./common";

function PermissionPage({ kind }: { kind: "support" | "deletion" }) {
  const { snapshot } = useWorkspace();
  const { t } = useI18n();
  const { view, href, search } = useView("history");
  const support = kind === "support";
  const title = t(support ? "previewManagement.support" : "previewManagement.deletion");
  const items = snapshot.workflow!.management.filter((item) => item.kind === kind);
  const selected = items.find((item) => item.id === search.get("item"));
  const admin = isTenantAdmin(snapshot.context);
  const links = [
    { to: href("history"), label: t("previewManagement.history") },
    ...(admin ? [{ to: href("new"), label: t("previewManagement.create") }] : []),
  ];
  let content;
  if (view === "new") content = admin ? <Panel title={title}>
    <Alert>{t(support ? "previewManagement.supportNotice" : "previewManagement.deletionNotice")}</Alert>
    <CommandForm intent="manage" hidden={{ kind, status: support ? "許可中" : "承認待ち" }} guard>
      <TextField id={`${kind}-name`} name="name" label={t(support ? "previewManagement.supportPurpose" : "previewManagement.deletionReason")} required />
      <Field id={`${kind}-detail`} label={t(support ? "previewManagement.supportScope" : "previewManagement.deletionScope")}>
        <Textarea id={`${kind}-detail`} name="detail" required placeholder={support ? t("previewManagement.supportPlaceholder") : undefined} />
      </Field>
      <label className={styles["workspace-check"]}><input type="checkbox" required />{t(support ? "previewManagement.supportConfirm" : "previewManagement.deletionConfirm")}</label>
      <CommandSubmit>{t(support ? "previewManagement.supportGrant" : "previewManagement.deletionSubmit")}</CommandSubmit>
    </CommandForm>
  </Panel> : <EmptyState title={t("previewManagement.forbidden")} />;
  else if (view === "detail" || view === "edit") content = selected ? <>
    <BackLink to={href("history")} />
    <ViewLinks selected={href(view, selected.id)} items={[
      { to: href("detail", selected.id), label: t("previewManagement.history") },
      { to: href("edit", selected.id), label: t("previewManagement.edit") },
    ]} />
    {view === "detail" ? <><Panel title={title}><strong>{selected.name}</strong><p>{selected.detail}</p></Panel><ItemHistory item={selected} /></>
      : <ManagementEditor item={selected} actions={support ? ["取消済み", "期限切れ"] : ["承認済み", "異議対応のため保留", "差し戻し", "実行済み（サンプル）"]} />}
  </> : <EmptyState title={t("previewManagement.missing")} />;
  else content = <Panel title={title}><ManagementList items={items} detailView="detail" /></Panel>;
  return <><ViewLinks items={links} selected={href(view)} />{content}</>;
}
export function SupportScreen() { return <PermissionPage kind="support" />; }
export function DeletionScreen() { return <PermissionPage kind="deletion" />; }
