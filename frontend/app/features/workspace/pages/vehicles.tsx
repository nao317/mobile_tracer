import { clientPage } from "../../management/navigation";
import workspaceStyles from "../workspace.module.css";
import uiStyles from "../../../components/ui/ui.module.css";
import { useCoreI18n } from "./core-messages";
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router";
import { CoreLink as Link } from "./navigation";

import { Badge, EmptyState, Panel } from "../../../components/ui/primitives";
import { isTenantAdmin } from "../model";

import { useWorkspace } from "../workspace-context";
import { Pagination } from "../../../components/molecules/pagination";

import { ListFilters } from "./shared";
export function VehiclesScreen() {
  const { c, formatDate, vehicleName, plateNumber } = useCoreI18n();

  const { snapshot, base, mode } = useWorkspace();
  const [search] = useSearchParams();
  const q = (search.get("q") ?? "").toLowerCase();
  const filtered =
    mode === "preview"
      ? snapshot.vehicles.filter((v) =>
        `${v.model_name} ${v.identifiers.map((i) => i.value).join(" ")}`
          .toLowerCase()
          .includes(q),
      )
      : snapshot.vehicles;
  const page = clientPage(filtered, search.get("page"));
  const items = mode === "preview" ? page.data : filtered;
  return (
    <>
      <> {isTenantAdmin(snapshot.context) && (
        <Link className={uiStyles["ui-link-button"]} to={`${base}/vehicles/new`}>
          <Plus size={16} aria-hidden="true" />
          {c("workspace.vehicle.create")}</Link>
      )} </>
      <Panel>
        <ListFilters />
      </Panel>
      <Panel title={c("workspace.vehicle.list")}>
        {items.length ? (
          <table className={[uiStyles["ui-table"], uiStyles["ui-table--responsive"]].join(" ")}>
            <thead>
              <tr>
                <th>{c("workspace.vehicle.title")}</th>
                <th>{c("workspace.vehicle.plate")}</th>
                <th>{c("workspace.vehicle.identifier")}</th>
                <th>{c("workspace.vehicle.createdAt")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id}>
                  <td data-label={c("workspace.vehicle.title")}>
                    <Link to={`${base}/vehicles/${v.id}`} fromHere>
                      {vehicleName(v)}
                    </Link>
                    <span className={workspaceStyles["workspace-table-subtitle"]}>
                      {v.id.slice(-6)}
                    </span>
                  </td>
                  <td data-label={c("workspace.vehicle.plate")}>{plateNumber(v)}</td>
                  <td data-label={c("workspace.vehicle.identifier")}>
                    <Badge
                      tone={
                        v.identifiers.some((i) => i.verified_at)
                          ? "success"
                          : "warning"
                      }
                    >
                      {v.identifiers.some((i) => i.verified_at)
                        ? c("workspace.vehicle.verified")
                        : c("workspace.vehicle.unverified")}
                    </Badge>
                  </td>
                  <td data-label={c("workspace.vehicle.createdAt")}>{formatDate(v.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title={c("workspace.vehicle.missing")}>
            {c("workspace.filter.change")}</EmptyState>
        )}
        <Pagination pagination={snapshot.pagination ?? page.pagination} />
      </Panel>
    </>
  );
}
