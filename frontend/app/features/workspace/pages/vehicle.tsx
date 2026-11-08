import { CoreBackLink } from "./navigation";
import { VehicleFormScreen } from "./vehicle-form";
import appStyles from "../../../app.module.css";
import workspaceStyles from "../workspace.module.css";
import uiStyles from "../../../components/ui/ui.module.css";
import { useCoreI18n } from "./core-messages";
import { Pagination } from "../../../components/molecules/pagination";
import { useSearchParams } from "react-router";
import { clientPage } from "../../management/navigation";

import { CoreLink as Link } from "./navigation";

import { Badge, EmptyState, Panel } from "../../../components/ui/primitives";
import { canWrite, isTenantAdmin } from "../model";
import { useWorkspace } from "../workspace-context";

import { CaseTable } from "./shared";
export function VehicleScreen({ vehicleId }: { vehicleId: string; }) {
  const { c, formatDate, vehicleName, plateNumber } = useCoreI18n();

  const { snapshot, base, mode } = useWorkspace();
  const [search] = useSearchParams();
  const related = snapshot.cases.filter(c => c.vehicle_id === vehicleId);
  const page = clientPage(related, search.get("relatedPage"));
  const item = snapshot.vehicles.find((v) => v.id === vehicleId);
  if (!item) return <EmptyState title={c("workspace.vehicle.missing")} />;
  if (search.get("view") === "edit") return <VehicleFormScreen vehicleId={vehicleId} />;
  return (
    <><CoreBackLink to={`${base}/vehicles`} />
      <> {canWrite(snapshot.context) && (
        <Link
          className={uiStyles["ui-link-button"]}
          to={`${base}/cases/new?vehicle=${item.id}`}
        >
          {c("workspace.vehicle.createCase")}</Link>
      )} </>
      <Panel title={c("workspace.vehicle.details")}>
        <dl className={workspaceStyles["workspace-summary"]}>
          <div><dt>{c("workspace.vehicle.model")}</dt><dd>{vehicleName(item)}</dd></div>
          <div><dt>{c("workspace.vehicle.plate")}</dt><dd>{plateNumber(item)}</dd></div>
          <div>
            <dt>{c("workspace.vehicle.createdAt")}</dt>
            <dd>{formatDate(item.created_at)}</dd>
          </div>
          <div>
            <dt>{c("workspace.vehicle.identifier")}</dt>
            <dd>
              {item.identifiers.filter(identifier => !identifier.valid_to).map((i) => (
                <p key={i.id}>
                  {i.value}{" "}
                  <Badge tone={i.verified_at ? "success" : "warning"}>
                    {i.verified_at ? c("workspace.vehicle.verified") : c("workspace.vehicle.unverified")}
                  </Badge>
                </p>
              ))}
            </dd>
          </div>
        </dl>
        <details className={workspaceStyles["workspace-details"]}>
          <summary>{c("workspace.vehicle.internalId")}</summary>
          <code>{item.id}</code>
        </details>
        {mode === "preview" && <div className={[uiStyles["ui-actions"], appStyles["mt-5"]].join(" ")}>
          <Link
            className={uiStyles["ui-text-link"]}
            to={`${base}/vehicles/${item.id}/history`}
          >
            {c("workspace.vehicle.history")}</Link>
        </div>}
        {isTenantAdmin(snapshot.context) && (
          <Link fromHere className={uiStyles["ui-text-link"]} to={`${base}/vehicles/${item.id}?view=edit`}>{c("workspace.vehicle.editModel")}</Link>
        )}
      </Panel>
      <Panel title={c("workspace.vehicle.cases")}>
        <CaseTable
          items={mode === "preview" ? page.data : related}
        />
        <Pagination pageKey="relatedPage" pagination={snapshot.relatedPagination ?? page.pagination} />
      </Panel>
    </>
  );
}
