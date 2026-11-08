import { clientPage } from "../../management/navigation";
import uiStyles from "../../../components/ui/ui.module.css";
import { useCoreI18n } from "./core-messages";
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router";
import { CoreLink as Link } from "./navigation";

import { Panel } from "../../../components/ui/primitives";
import { canWrite } from "../model";

import { useWorkspace } from "../workspace-context";
import { Pagination } from "../../../components/molecules/pagination";

import { CaseTable } from "./shared";
import { ListFilters } from "./shared";
export function CasesScreen() {
  const { c, vehicleName } = useCoreI18n();

  const { snapshot, base, mode } = useWorkspace();
  const [search] = useSearchParams();
  const q = (search.get("q") ?? "").toLowerCase();
  const filtered =
    mode === "preview"
      ? snapshot.cases.filter(
        (c) =>
          vehicleName(snapshot.vehicles.find((v) => v.id === c.vehicle_id))
            .toLowerCase()
            .includes(q) &&
          (!search.get("case_type") ||
            search.get("case_type") === c.case_type) &&
          (!search.get("status") || search.get("status") === c.status),
      )
      : snapshot.cases;
  const page = clientPage(filtered, search.get("page"));
  return (
    <>
      <> {canWrite(snapshot.context) && (
        <Link className={uiStyles["ui-link-button"]} to={`${base}/cases/new`}>
          <Plus size={16} aria-hidden="true" />
          {c("workspace.case.create")}</Link>
      )} </>
      <Panel>
        <ListFilters cases />
      </Panel>
      <Panel title={c("workspace.case.list")}>
        <CaseTable
          items={
            mode === "preview"
              ? page.data
              : filtered
          }
        />
        <Pagination pagination={snapshot.pagination ?? page.pagination} />
      </Panel>
    </>
  );
}
