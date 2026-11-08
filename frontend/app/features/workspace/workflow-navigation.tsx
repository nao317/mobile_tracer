import { Link, useSearchParams, type LinkProps } from "react-router";
import { useI18n } from "../../components/ui/display-settings";
import type { TranslationKey } from "../../i18n";
import uiStyles from "../../components/ui/ui.module.css";

export function workflowQuery(search: URLSearchParams, updates: Record<string, string | null>) {
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) next.delete(key); else next.set(key, value);
  }
  return `?${next}`;
}
export function WorkflowLink({ view, item, version, ...props }: Omit<LinkProps, "to"> & { view: string; item?: string; version?: string }) {
  const [search] = useSearchParams();
  return <Link {...props} to={workflowQuery(search, { view, item: item ?? null, ...(version ? { version } : {}) })} />;
}
export function WorkflowViews({ items, selected }: { items: readonly { view: string; label: Extract<TranslationKey, `workflow.nav.${string}`> }[]; selected: string }) {
  const { t } = useI18n();
  return <div className={uiStyles["ui-actions"]}>{items.map(item => <WorkflowLink key={item.view} view={item.view} aria-current={selected === item.view ? "page" : undefined} className={uiStyles["ui-text-link"]}>{t(item.label)}</WorkflowLink>)}</div>;
}
export function useClientPage<T>(items: T[], pageKey = "page") {
  const [search] = useSearchParams();
  const raw = Number(search.get(pageKey) || "1"), last = Math.max(1, Math.ceil(items.length / 20));
  const page = Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, last) : 1;
  return { data: items.slice((page - 1) * 20, page * 20), pagination: { page, page_size: 20, total: items.length } };
}
