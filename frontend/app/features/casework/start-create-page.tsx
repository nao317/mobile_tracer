import {
  Alert,
  Field,
  Panel,
  Select,
  TextField,
  Textarea,
} from "../../components/ui/primitives";
import { Link } from "react-router";
import { CaseworkForm } from "./shared";

import type {
  BusinessContext,
  Vehicle,
  BusinessCase,
} from "../workspace/model";
export function CaseStartForm({
  context,
  vehicles,
  existing,
  csrf,
  requestKey,
  error,
}: {
  context: BusinessContext;
  vehicles: Vehicle[];
  existing: {
    case: BusinessCase;
    vehicle: Vehicle;
    terms?: { terms: string };
  } | null;
  csrf: string;
  requestKey: string;
  error?: string;
}) {
  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      <Panel title="相手に提示する案件条件">
        <p>
          顧客の承認までは仮の案件として保存します。作業や進行報告は、開始承認後に行えます。
        </p>
        <CaseworkForm
          intent="start-create"
          csrf={csrf}
          requestKey={requestKey}
          label="案件条件を固定して顧客へ提示する"
        >
          <input type="hidden" name="case_id" value={existing?.case.id ?? ""} />
          <input
            type="hidden"
            name="configuration_version_id"
            value={
              existing?.case.configuration_version_id ??
              context.configuration?.id ??
              ""
            }
          />
          <input
            type="hidden"
            name="assignee_id"
            value={existing?.case.assignee_id ?? context.principal.staff_id}
          />
          {existing && (
            <>
              <input
                type="hidden"
                name="store_id"
                value={existing.case.store_id}
              />
              <input
                type="hidden"
                name="vehicle_id"
                value={existing.case.vehicle_id}
              />
              <input
                type="hidden"
                name="case_type"
                value={existing.case.case_type}
              />
            </>
          )}
          <Field id="store" label="担当店舗">
            <Select
              id="store"
              name="store_id"
              disabled={!!existing}
              defaultValue={existing?.case.store_id}
              required
            >
              {context.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="vehicle" label="車両">
            <Select
              id="vehicle"
              name="vehicle_id"
              disabled={!!existing}
              defaultValue={existing?.vehicle.id}
              required
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.model_name ?? "車種未登録"} /{" "}
                  {v.identifiers.find((id) => id.kind === "plate_number")
                    ?.value ?? v.id}
                </option>
              ))}
            </Select>
          </Field>
          {!existing && (
            <p>
              <Link to="/app/vehicles">車両一覧から選び直す</Link>
            </p>
          )}
          <Field id="case-type" label="取引種別">
            <Select
              id="case-type"
              name="case_type"
              disabled={!!existing}
              defaultValue={existing?.case.case_type}
              required
            >
              {Object.keys(
                context.configuration?.settings.businesses ?? {},
              ).map((kind) => (
                <option key={kind} value={kind}>
                  {{ rental: "貸出", dealer: "販売", repair: "整備・修理" }[
                    kind
                  ] ?? kind}
                </option>
              ))}
            </Select>
          </Field>
          <TextField
            id="email"
            name="email"
            type="email"
            label="顧客の登録メールアドレス"
            required
          />
          <Field id="terms" label="取引内容・車両状態・条件・金額">
            <Textarea
              id="terms"
              name="terms"
              required
              maxLength={8000}
              defaultValue={existing?.terms?.terms}
            />
          </Field>
          <TextField
            id="deadline"
            name="deadline"
            type="datetime-local"
            label="案件開始の回答期限"
            required
          />
        </CaseworkForm>
      </Panel>
    </>
  );
}
