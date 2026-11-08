import { CoreBackLink } from "./navigation";
import uiStyles from "../../../components/ui/ui.module.css";
import workspaceStyles from "../workspace.module.css";
import { useCoreI18n } from "./core-messages";
import { Pagination } from "../../../components/molecules/pagination";
import { useSearchParams } from "react-router";
import { clientPage } from "../../management/navigation";

import { CoreLink as Link } from "./navigation";

import { Panel } from "../../../components/ui/primitives";
import { type BusinessCase } from "../model";

import { useWorkspace } from "../workspace-context";

export function RecordHistoryScreen({ item, recordId }: { item: BusinessCase; recordId: string ;}) {
  const { c, formatDate } = useCoreI18n();

  const [search] = useSearchParams();
  const { snapshot, base, mode } = useWorkspace(); const path = `${base}/cases/${item.id}/records/${recordId}`;
  const versions = snapshot.versions.filter(v => v.record_id === recordId && v.case_id === item.id).sort((a, b) => b.version_no - a.version_no);
  const page = clientPage(versions, search.get("historyPage"));
  return (
    <>
      <CoreBackLink to={`${base}/cases/${item.id}/records/${recordId}`} />
      <Panel title={c("workspace.record.history")}>
    <ol className={workspaceStyles["workspace-timeline"]}>
      {(mode === "preview" ? page.data : versions)
        .map((v) => (
          <li key={v.id}>
            <Link className={uiStyles["ui-text-link"]} to={`${path}?version=${v.id}`} fromHere>
              v{v.version_no}・
              {v.status === "submitted" ? c("workspace.record.submitted") : c("workspace.record.draft")}
            </Link>
            <p className={uiStyles["ui-muted"]}>
              {v.change_reason || c("workspace.record.firstVersion")} / {formatDate(v.created_at)}
            </p>
          </li>
        ))}
    </ol>
    <Pagination pageKey="historyPage" pagination={snapshot.historyPagination ?? page.pagination} />
  </Panel>
  </>
  );
}
