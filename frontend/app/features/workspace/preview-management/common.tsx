import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { useI18n } from "../../../components/ui/display-settings";
import { Badge, EmptyState, Field, Panel, Select, TextField } from "../../../components/ui/primitives";
import { Pagination } from "../../../components/molecules/pagination";
import ui from "../../../components/ui/ui.module.css";
import styles from "../workspace.module.css";
import { CommandForm, CommandSubmit } from "../command-form";
import { businessTypes, canManage, roleLabels, type ManagementItem } from "../model";
import { useWorkspace } from "../workspace-context";
import type { TranslationKey } from "../../../i18n";
export { ui, styles };

/** Slice a displayed collection without changing the persisted preview snapshot. */
export function clientPage<T>(items: readonly T[], requested: string | null) {
  const parsed = requested && /^\d+$/.test(requested) ? Number(requested) : 1;
  const last = Math.max(1, Math.ceil(items.length / 20));
  const page = Math.max(1, Math.min(Number.isSafeInteger(parsed) ? parsed : 1, last));
  return { items: items.slice((page - 1) * 20, page * 20), pagination: { page, page_size: 20, total: items.length } };
}
export function useClientPage<T>(items: readonly T[], key = "page") {
  const [search, setSearch] = useSearchParams();
  const result = clientPage(items, search.get(key));
  const normalized = result.pagination.page;
  useEffect(() => {
    if (search.has(key) && search.get(key) !== String(normalized)) {
      const next = new URLSearchParams(search);
      next.set(key, String(normalized));
      setSearch(next, { replace: true });
    }
  }, [key, normalized, search, setSearch]);
  return result;
}
export function useView(fallback: string) {
  const [search, setSearch] = useSearchParams();
  const href = (view: string, item?: string) => {
    const next = new URLSearchParams(search);
    next.set("view", view);
    if (item) next.set("item", item);
    else next.delete("item");
    return `?${next}`;
  };
  return { view: search.get("view") ?? fallback, search, setSearch, href };
}
export function ViewLinks({ items, selected }: { items: { to: string; label: string }[]; selected: string }) {
  const { t } = useI18n();
  return <nav className={styles["workspace-tabs"]} aria-label={t("previewManagement.navigation")}>
    {items.map((item) => <Link key={item.to} to={item.to} aria-current={selected === item.to ? "page" : undefined}>{item.label}</Link>)}
  </nav>;
}
const statusKeys = {
  "有効": "active", "停止": "suspended", "招待取消し": "invitationCancelled", "招待中": "invited",
  "取消済み": "revoked", "期限切れ": "expired", "許可中": "permitted", "承認待ち": "pending",
  "承認済み": "approved", "異議対応のため保留": "onHold", "差し戻し": "returned", "実行済み（サンプル）": "executed",
  "試行中": "trial", "顧客確認待ち": "customerReview", "利用中": "inUse", "作成失敗": "failed",
  "試行済み": "trialComplete", "反映済み": "applied", "確認済み・取込結果サンプル": "imported", "下書き": "draft",
} as const;
const actionKeys = {
  createVehicle: "previewManagement.command.createVehicle",
  updateVehicle: "previewManagement.command.updateVehicle",
  createCase: "previewManagement.command.createCase",
  createRecord: "previewManagement.command.createRecord",
  updateDraft: "previewManagement.command.updateDraft",
  updateCase: "previewManagement.command.updateCase",
  assignCase: "previewManagement.command.assignCase",
  cancelCase: "previewManagement.command.cancelCase",
  completeCase: "previewManagement.command.completeCase",
  submitRecord: "previewManagement.command.submitRecord",
  correctRecord: "previewManagement.command.correctRecord",
  photo: "previewManagement.command.photo",
  answer: "previewManagement.command.answer",
  requestConfirmation: "previewManagement.command.requestConfirmation",
  newDispute: "previewManagement.command.newDispute",
  advanceDispute: "previewManagement.command.advanceDispute",
  maskPhoto: "previewManagement.command.maskPhoto",
  share: "previewManagement.command.share",
  revokeShare: "previewManagement.command.revokeShare",
  retryRegistration: "previewManagement.command.retryRegistration",
  verify: "previewManagement.command.verify",
  updateIdentifier: "previewManagement.command.updateIdentifier",
  mergeVehicle: "previewManagement.command.mergeVehicle",
  previewConfiguration: "previewManagement.command.previewConfiguration",
  applyConfiguration: "previewManagement.command.applyConfiguration",
  manage: "previewManagement.command.manage",
  "受付時の記録を提出": "previewManagement.command.initialSubmission",
} as const;
export function useManagementLabels() {
  const { t, enumLabel } = useI18n();
  const status = (value: string) => {
    const key = statusKeys[value as keyof typeof statusKeys];
    return key ? t(`previewManagement.status.${key}`) : value;
  };
  const detail = (value: string) => {
    const role = Object.entries(roleLabels).find(([, label]) => label === value)?.[0];
    if (role) return enumLabel("role", role);
    if (value === "三業態共通テンプレート") return t("previewManagement.allBusinesses");
    const business = Object.entries(businessTypes).find(([, label]) => label === value)?.[0];
    return business ? enumLabel("business", business) : value;
  };
  const action = (value: string) => {
    const key = actionKeys[value as keyof typeof actionKeys];
    return key ? t(key) : value;
  };
  return { status, detail, action };
}
export function BackLink({ to }: { to: string }) {
  const { t } = useI18n();
  return <Link className={ui["ui-text-link"]} to={to}>{t("previewManagement.back")}</Link>;
}
export function ManagementList({ items, detailView }: { items: ManagementItem[]; detailView: string }) {
  const { t } = useI18n();
  const { href } = useView("list");
  const labels = useManagementLabels();
  const page = useClientPage(items);
  return <>
    {page.items.length ? <div className={ui["ui-stack"]}>{page.items.map((item) => <article key={item.id}>
      <div className={ui["ui-actions"]}><strong>{item.name}</strong><Badge>{labels.status(item.status)}</Badge></div>
      {item.kind !== "configuration" && <p className={ui["ui-muted"]}>{labels.detail(item.detail)}</p>}
      <Link className={ui["ui-text-link"]} to={href(detailView, item.id)}>{t("previewManagement.review")}</Link>
    </article>)}</div> : <EmptyState title={t("previewManagement.empty")} />}
    <Pagination pagination={page.pagination} />
  </>;
}
export function ItemHistory({ item }: { item: ManagementItem }) {
  const { t } = useI18n();
  const history = useClientPage(item.history, "historyPage");
  return <Panel title={t("previewManagement.history")}>
    {history.items.length ? <ol className={styles["workspace-timeline"]}>{history.items.map((entry, index) => <li key={(history.pagination.page - 1) * 20 + index}>{entry}</li>)}</ol> : <EmptyState title={t("previewManagement.empty")} />}
    <Pagination pagination={history.pagination} pageKey="historyPage" />
  </Panel>;
}
export function ManagementEditor({ item, actions }: { item: ManagementItem; actions: string[] }) {
  const { snapshot } = useWorkspace();
  const { t } = useI18n();
  const labels = useManagementLabels();
  if (!canManage(snapshot.context)) return <EmptyState title={t("previewManagement.forbidden")} />;
  return <Panel title={t("previewManagement.edit")}>
    <strong>{item.name}</strong>
    <p>{labels.detail(item.detail)}</p>
    <CommandForm intent="manage" hidden={{ managementId: item.id }} guard>
      <Field id="management-status" label={t("previewManagement.nextStatus")}>
        <Select id="management-status" name="status" defaultValue={actions.includes(item.status) ? item.status : actions[0]}>
          {actions.map((status) => <option value={status} key={status}>{labels.status(status)}</option>)}
        </Select>
      </Field>
      <TextField id="management-note" name="note" label={t("previewManagement.note")} required />
      <label className={styles["workspace-check"]}><input type="checkbox" required />{t("previewManagement.confirmChange")}</label>
      <CommandSubmit>{t("previewManagement.update")}</CommandSubmit>
    </CommandForm>
  </Panel>;
}
export type ManagementKey = Extract<TranslationKey, `previewManagement.${string}`>;
