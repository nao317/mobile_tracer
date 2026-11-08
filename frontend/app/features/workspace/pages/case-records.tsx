import { CoreBackLink } from "./navigation";
import workspaceStyles from "../workspace.module.css";
import uiStyles from "../../../components/ui/ui.module.css";
import { useCoreI18n } from "./core-messages";
import { Pagination } from "../../../components/molecules/pagination";
import { useSearchParams } from "react-router";
import { clientPage } from "../../management/navigation";
import { Plus } from "lucide-react";

import { CoreLink as Link } from "./navigation";

import { EmptyState, Panel } from "../../../components/ui/primitives";
import { canWrite, rulesFor, type BusinessCase } from "../model";

import { useWorkspace } from "../workspace-context";

export function CaseRecordsScreen({ item }: { item: BusinessCase; }) {
  const { c, formatDate } = useCoreI18n();

  const { snapshot, base, mode } = useWorkspace();
  const [search] = useSearchParams();
  const records = snapshot.records.filter((r) => r.case_id === item.id);
  const page = clientPage(records, search.get("recordsPage"));
  const rules = rulesFor(snapshot, item), editable = canWrite(snapshot.context, item);
  return (
    <>
      <CoreBackLink to={`${base}/cases/${item.id}`} />
      <Panel
    title={c("workspace.record.title")}
    actions={
      editable &&
      rules && (
        <Link
          className={uiStyles["ui-link-button"]}
          to={`${base}/cases/${item.id}/records/new`}
        >
          <Plus size={16} aria-hidden="true" />
          {c("workspace.record.add")}</Link>
      )
    }
  >
    {records.length ? (
      <table className={[uiStyles["ui-table"], uiStyles["ui-table--responsive"]].join(" ")}>
        <thead>
          <tr>
            <th>{c("workspace.record.title")}</th>
            <th>{c("workspace.common.createdAt")}</th>
            <th>{c("workspace.common.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {(mode === "preview" ? page.data : records).map((r) => (
            <tr key={r.id}>
              <td data-label={c("workspace.record.title")}>
                {r.record_kind === "inspection"
                  ? c("workspace.record.inspection")
                  : r.record_kind}
                <span className={workspaceStyles["workspace-table-subtitle"]}>
                  {r.id.slice(-6)}
                </span>
              </td>
              <td data-label={c("workspace.common.createdAt")}>{formatDate(r.created_at)}</td>
              <td data-label={c("workspace.common.actions")}>
                <Link to={`${base}/cases/${item.id}/records/${r.id}`} fromHere>
                  {c("workspace.record.open")}</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <EmptyState title={c("workspace.record.empty")}>
        {c("workspace.record.emptyHint")}</EmptyState>
    )}
    <Pagination pageKey="recordsPage" pagination={snapshot.recordsPagination ?? page.pagination} />
  </Panel>
  </>
  );
}
