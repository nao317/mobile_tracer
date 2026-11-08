import uiStyles from "../../../components/ui/ui.module.css";
import { useCoreI18n } from "./core-messages";

import { CoreLink as Link } from "./navigation";

import { EmptyState, Field, Panel, Select, TextField } from "../../../components/ui/primitives";
import { isTenantAdmin } from "../model";
import { CommandForm, CommandSubmit } from "../command-form";
import { useWorkspace } from "../workspace-context";

export function VehicleFormScreen({ vehicleId }: { vehicleId?: string; }) {
  const { c } = useCoreI18n();

  const { snapshot, base } = useWorkspace();
  const vehicle = snapshot.vehicles.find((v) => v.id === vehicleId);
  if (vehicleId && !vehicle) return <EmptyState title={c("workspace.vehicle.missing")} />;
  if (!isTenantAdmin(snapshot.context))
    return (
      <EmptyState title={c("workspace.access.tenantAdmin")}>
        {c("workspace.vehicle.createdHint")}</EmptyState>
    );
  return (
    <>
      <></>
      <Panel>
        <CommandForm
          intent={vehicle ? "updateVehicle" : "createVehicle"}
          hidden={vehicle ? { vehicleId: vehicle.id } : {}}
          guard
        >
          <TextField
            id="model_name"
            name="model_name"
            label={c("workspace.vehicle.model")}
            maxLength={200}
            defaultValue={vehicle?.model_name ?? ""}
          />
          {!vehicle && (
            <>
              <Field id="identifier-kind" label={c("workspace.vehicle.identifierType")}>
                <Select id="identifier-kind" name="kind">
                  <option value="plate_number">{c("workspace.vehicle.plate")}</option>
                  <option value="chassis_number">{c("workspace.vehicle.vin")}</option>
                  <option value="vin">VIN</option>
                </Select>
              </Field>
              <TextField
                id="identifier"
                name="identifier"
                label={c("workspace.vehicle.identifier")}
                maxLength={100}
                hint={c("workspace.vehicle.identifierHint")}
              />
            </>
          )}
          <div className={uiStyles["ui-actions"]}>
            <CommandSubmit>
              {vehicle ? c("workspace.vehicle.saveModel") : c("workspace.vehicle.create")}
            </CommandSubmit>
            <Link className={uiStyles["ui-text-link"]} to={`${base}/vehicles`} back>
              {c("workspace.vehicle.back")}</Link>
          </div>
        </CommandForm>
      </Panel>
    </>
  );
}
