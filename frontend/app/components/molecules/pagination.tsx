import { Link, useLocation } from "react-router";
import { useTranslation, useDisplaySettings } from "../ui/display-settings";
import styles from "./pagination.module.css";

export function Pagination({ pagination, pageKey = "page" }: { pagination: { page: number; page_size: number; total: number }; pageKey?: string }) {
  const t = useTranslation();
  const { language } = useDisplaySettings();
  const { pathname, search } = useLocation();
  const { page, page_size, total } = pagination;
  const pages = Math.max(1, Math.ceil(total / page_size));
  const format = (n: number) => new Intl.NumberFormat(language === "ja" ? "ja-JP" : "en-US").format(n);
  const from = total ? (page - 1) * page_size + 1 : 0;
  const to = Math.min(page * page_size, total);
  function url(value: number) { const next = new URLSearchParams(search); next.set(pageKey, String(value)); return `${pathname}?${next}`; }
  const numbers = [...new Set([1, page - 1, page, page + 1, pages].filter(value => value >= 1 && value <= pages))].sort((a, b) => a - b);
  return <nav className={styles.pagination} aria-label={t("navigation.pagination")}>
    <div role="status" aria-live="polite">{t("navigation.paginationSummary", { from: format(from), to: format(to), total: format(total) })} · {t("navigation.pageSummary", { page: format(page), pages: format(pages) })}</div>
    <div className={styles.controls}>
      {page > 1 ? <Link className={styles.item} to={url(page - 1)}>{t("navigation.previous")}</Link> : <span className={styles.item} aria-disabled="true">{t("navigation.previous")}</span>}
      {numbers.map((value, index) => <span key={value}>{index > 0 && value - numbers[index - 1] > 1 && <span aria-hidden="true"> … </span>}{value === page ? <span className={styles.item} aria-current="page">{format(value)}</span> : <Link className={styles.item} to={url(value)}>{format(value)}</Link>}</span>)}
      {page < pages ? <Link className={styles.item} to={url(page + 1)}>{t("navigation.next")}</Link> : <span className={styles.item} aria-disabled="true">{t("navigation.next")}</span>}
    </div>
  </nav>;
}
