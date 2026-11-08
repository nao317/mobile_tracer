import { useI18n } from "../../../components/ui/display-settings";
import { EmptyState, Field, Panel, Select, TextField } from "../../../components/ui/primitives";
import { CommandForm, CommandSubmit } from "../command-form";
import { isTenantAdmin, roleLabels } from "../model";
import { useWorkspace } from "../workspace-context";
import { BackLink, ItemHistory, ManagementEditor, ManagementList, ViewLinks, useView } from "./common";

export function OrganizationScreen() {
  const { snapshot } = useWorkspace();
  const { t, enumLabel } = useI18n();
  const { view, href, search } = useView("stores");
  const staff = view.startsWith("staff");
  const kind = staff ? "staff" : "store";
  const listView = staff ? "staff" : "stores";
  const items = snapshot.workflow!.management.filter((item) => item.kind === kind);
  const selected = items.find((item) => item.id === search.get("item"));
  const admin = isTenantAdmin(snapshot.context);
  const links = [
    { to: href("stores"), label: t("previewManagement.stores") },
    { to: href("staff"), label: t("previewManagement.staff") },
    ...(admin ? [{ to: href("stores-new"), label: t("previewManagement.addStore") }, { to: href("staff-new"), label: t("previewManagement.inviteStaff") }] : []),
  ];
  let content;
  if (view.endsWith("-new")) {
    content = admin ? <Panel title={t(staff ? "previewManagement.inviteStaff" : "previewManagement.addStore")}>
      <CommandForm intent="manage" hidden={{ kind, status: staff ? "招待中" : "有効" }} guard>
        <TextField id="management-name" name="name" type={staff ? "email" : "text"} label={t(staff ? "previewManagement.staffEmail" : "previewManagement.storeName")} required />
        {staff ? <>
          <Field id="staff-role" label={t("previewManagement.staffRole")}><Select id="staff-role" name="detail">
            {Object.entries(roleLabels).map(([role, label]) => <option value={label} key={role}>{enumLabel("role", role)}</option>)}
          </Select></Field>
          <Field id="staff-store" label={t("previewManagement.staffStore")}><Select id="staff-store" name="store_id">
            {snapshot.context.stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
          </Select></Field>
        </> : <TextField id="store-detail" name="detail" label={t("previewManagement.storeBusiness")} required />}
        <CommandSubmit>{t(staff ? "previewManagement.invite" : "previewManagement.addStore")}</CommandSubmit>
      </CommandForm>
    </Panel> : <EmptyState title={t("previewManagement.forbidden")} />;
  } else if (view.endsWith("-edit") || view.endsWith("-history")) {
    content = selected ? <>
      <BackLink to={href(listView)} />
      <ViewLinks selected={href(view, selected.id)} items={[
        { to: href(`${listView}-edit`, selected.id), label: t("previewManagement.edit") },
        { to: href(`${listView}-history`, selected.id), label: t("previewManagement.history") },
      ]} />
      {view.endsWith("-history") ? <ItemHistory item={selected} /> : <ManagementEditor item={selected} actions={staff ? ["有効", "停止", "招待取消し"] : ["有効", "停止"]} />}
    </> : <EmptyState title={t("previewManagement.missing")} />;
  } else {
    content = <Panel title={t(staff ? "previewManagement.staff" : "previewManagement.stores")}><ManagementList items={items} detailView={`${listView}-edit`} /></Panel>;
  }
  return <><ViewLinks items={links} selected={href(view)} />{content}</>;
}
