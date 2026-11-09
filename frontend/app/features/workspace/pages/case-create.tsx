import uiStyles from "../../../components/ui/ui.module.css";
import workspaceStyles from "../workspace.module.css";
import { useCoreI18n } from "./core-messages";

import { useSearchParams } from "react-router";
import { CoreLink as Link } from "./navigation";

import { EmptyState, Field, Panel, Select } from "../../../components/ui/primitives";
import { businessTypes, canWrite } from "../model";
import { CommandForm, CommandSubmit } from "../command-form";
import { useWorkspace } from "../workspace-context";

export function CaseCreateScreen() {
  const { c, enumLabel, vehicleName, plateNumber } = useCoreI18n();

  const { snapshot, base, mode } = useWorkspace();
  const [search] = useSearchParams();
  if(mode==="live") return <Panel title="案件開始の提案"><Link to={`/casework/new${search.get("vehicle")?`?vehicle=${search.get("vehicle")}`:""}`}>顧客に開始条件を提示する</Link></Panel>;
  if (!canWrite(snapshot.context))
    return <EmptyState title={c("workspace.access.createCase")} />;
  if (
    !snapshot.context.configuration ||
    !Object.keys(snapshot.context.configuration.settings.businesses).length
  )
    return (
      <EmptyState title={c("workspace.case.noConfiguration")}>
        {c("workspace.case.configurationHint")}</EmptyState>
    );
  return (
    <>
      <></>
      <Panel>
        <CommandForm intent="createCase" guard>
          <Field id="store_id" label={c("workspace.case.storeField")}>
            <Select id="store_id" name="store_id" required>
              {snapshot.context.stores.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="vehicle_id" label={c("workspace.vehicle.title")}>
            <Select
              id="vehicle_id"
              name="vehicle_id"
              required
              defaultValue={search.get("vehicle") ?? ""}
            >
              <option value="">{c("workspace.case.chooseVehicle")}</option>
              {[...(snapshot.selectedVehicle && !snapshot.vehicles.some(v => v.id === snapshot.selectedVehicle!.id) ? [snapshot.selectedVehicle] : []), ...snapshot.vehicles].map((v) => (
                <option value={v.id} key={v.id}>
                  {vehicleName(v)} / {plateNumber(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="case_type" label={c("workspace.case.business")}>
            <Select id="case_type" name="case_type" required>
              <option value="">{c("workspace.case.chooseBusiness")}</option>
              {Object.entries(businessTypes)
                .filter(
                  ([key]) =>
                    snapshot.context.configuration?.settings.businesses[key],
                )
                .map(([key]) => (
                  <option key={key} value={key}>
                    {enumLabel("business", key)}
                  </option>
                ))}
            </Select>
          </Field>
          <label className={workspaceStyles["workspace-check"]}>
            <input
              type="checkbox"
              name="assign_self"
              value="1"
              defaultChecked
            />
            {c("workspace.case.assignSelf")}</label>
          <p className={uiStyles["ui-hint"]}>
            {c("workspace.case.assignmentAvailability")}</p>
          <div className={uiStyles["ui-actions"]}>
            <CommandSubmit>{c("workspace.case.create")}</CommandSubmit>
            <Link className={uiStyles["ui-text-link"]} to={`${base}/cases`} back>
              {c("workspace.case.back")}</Link>
          </div>
        </CommandForm>
      </Panel>
    </>
  );
}
