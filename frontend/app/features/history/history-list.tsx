import { Link } from "react-router";
import { EmptyState, Panel } from "../../components/ui/primitives";
import { Pagination } from "../../components/molecules/pagination";
import { useI18n } from "../../components/ui/display-settings";
import type { HistoryPage } from "./model";
import styles from "../../components/ui/ui.module.css";

export function HistoryList({ data, pagination }: HistoryPage) {
  const { t, formatDate } = useI18n();
  return <Panel title={t("history.title")}>
    <p>{t("history.description")}</p>
    {data.length ? <ol className={styles["ui-stack"]}>{data.map(item => {
      const kind = item.target_type === "record_version" ? "history.record" : item.target_type === "case" ? "history.case" : "history.application";
      const to = item.target_type === "record_version" ? `/transactions/${item.target_id}/approval` : item.target_type === "case" ? `/casework/${item.target_id}/timeline` : `${item.own_application ? "/account" : "/admin"}/requests?view=detail&request=${item.target_id}`;
      const action = item.action.endsWith("approved") || item.decision === "approved" ? "history.approved" : item.action.endsWith("rejected") || item.decision === "rejected" ? "history.rejected" : item.decision === "held" ? "history.held" : item.action.endsWith("present") ? "history.presented" : item.action.endsWith("photo") ? "history.photo" : item.action.endsWith("request_created") ? "history.applied" : "history.updated";
      return <li key={`${item.target_type}:${item.target_id}`}>
        <Link className={styles["ui-text-link"]} to={to}>{t(kind)} · {item.target_id}</Link>
        <p>{t(action)} · <time dateTime={item.at}>{formatDate(item.at)}</time> · {t("history.count", { count: item.count })}</p>
      </li>;
    })}</ol> : <EmptyState title={t("history.empty")} />}
    <Pagination pagination={pagination} />
  </Panel>;
}
