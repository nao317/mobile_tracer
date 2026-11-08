import appStyles from "../../../app.module.css";
import workspaceStyles from "../workspace.module.css";
import uiStyles from "../../../components/ui/ui.module.css";
import { useCoreI18n } from "./core-messages";
import { Search } from "lucide-react";
import { Form, useSearchParams } from "react-router";
import { CoreLink as Link } from "./navigation";

import { Badge, Button, EmptyState, Field, Input, Select } from "../../../components/ui/primitives";
import { businessTypes, type BusinessCase, type Version } from "../model";

import { useWorkspace } from "../workspace-context";

export function CaseTable({ items }: { items: BusinessCase[]; }) {
  const { c, enumLabel, vehicleName, plateNumber } = useCoreI18n();

  const { snapshot, base } = useWorkspace();
  if (!items.length)
    return (
      <EmptyState title={c("workspace.case.empty")}>
        {c("workspace.case.emptySearch")}</EmptyState>
    );
  return (
    <table className={[uiStyles["ui-table"], uiStyles["ui-table--responsive"]].join(" ")}>
      <thead>
        <tr>
          <th>{c("workspace.case.vehicleCase")}</th>
          <th>{c("workspace.case.business")}</th>
          <th>{c("workspace.case.store")}</th>
          <th>{c("workspace.case.stage")}</th>
          <th>{c("workspace.common.status")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td data-label={c("workspace.case.vehicleCase")}>
              <Link to={`${base}/cases/${item.id}`} fromHere>
                {vehicleName(
                  snapshot.vehicles.find((v) => v.id === item.vehicle_id),
                )}
              </Link>
              <span className={workspaceStyles["workspace-table-subtitle"]}>
                {plateNumber(
                  snapshot.vehicles.find((v) => v.id === item.vehicle_id),
                )}{" "}
                / {item.id.slice(-6)}
              </span>
            </td>
            <td data-label={c("workspace.case.business")}>{enumLabel("business", item.case_type)}</td>
            <td data-label={c("workspace.case.store")}>
              {snapshot.context.stores.find((s) => s.id === item.store_id)
                ?.name ?? c("workspace.case.assignedStore")}
            </td>
            <td data-label={c("workspace.case.stage")}>
              {enumLabel("stage", item.stage)}
            </td>
            <td data-label={c("workspace.common.status")}>
              <Badge
                tone={
                  item.status === "completed"
                    ? "success"
                    : item.status === "cancelled"
                      ? "neutral"
                      : "info"
                }
              >
                {item.status === "completed"
                  ? c("workspace.case.completed")
                  : item.status === "cancelled"
                    ? c("workspace.case.cancelled")
                    : c("workspace.case.inProgress")}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ListFilters({ cases = false }: { cases?: boolean; }) {
  const { c, enumLabel } = useCoreI18n();

  const [search] = useSearchParams();
  return (
    <Form method="get" className={workspaceStyles["workspace-filter"]}>
      {search.get("page_size") && <input type="hidden" name="page_size" value={search.get("page_size")!} />}
      <Field id="search-q" label={c("workspace.filter.search")}>
        <Input
          id="search-q"
          name="q"
          placeholder={cases ? c("workspace.filter.casePlaceholder") : c("workspace.filter.vehiclePlaceholder")}
          defaultValue={search.get("q") ?? ""}
          maxLength={200}
        />
      </Field>
      {cases && (
        <>
          <Field id="case-type" label={c("workspace.case.business")}>
            <Select
              id="case-type"
              name="case_type"
              defaultValue={search.get("case_type") ?? ""}
            >
              <option value="">{c("workspace.filter.allBusinesses")}</option>
              {Object.entries(businessTypes).map(([key]) => (
                <option value={key} key={key}>
                  {enumLabel("business", key)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="case-status" label={c("workspace.case.status")}>
            <Select
              id="case-status"
              name="status"
              defaultValue={search.get("status") ?? ""}
            >
              <option value="">{c("workspace.filter.allStatuses")}</option>
              <option value="in_progress">{c("workspace.case.inProgress")}</option>
              <option value="completed">{c("workspace.case.completed")}</option>
              <option value="cancelled">{c("workspace.case.cancelled")}</option>
            </Select>
          </Field>
        </>
      )}
      <Button type="submit" variant="secondary">
        <Search size={16} aria-hidden="true" />
        {c("workspace.filter.submit")}</Button>
    </Form>
  );
}

export function selectedVersion(
  versions: Version[],
  recordId: string,
  versionId: string | null,
) {
  const items = versions
    .filter((v) => v.record_id === recordId)
    .sort((a, b) => b.version_no - a.version_no);
  return versionId ? items.find((v) => v.id === versionId) : items[0];
}

export function VersionDetails({ version }: { version: Version; }) {
  const { c, fieldLabel, formatDate, formatNumber } = useCoreI18n();

  return (
    <>
      <dl className={workspaceStyles["workspace-summary"]}>
        <div>
          <dt>{c("workspace.record.version")}</dt>
          <dd>
            v{version.version_no}{" "}
            <Badge
              tone={version.status === "submitted" ? "success" : "warning"}
            >
              {version.status === "submitted" ? c("workspace.record.submitted") : c("workspace.record.draft")}
            </Badge>
          </dd>
        </div>
        <div>
          <dt>{c("workspace.record.submittedAt")}</dt>
          <dd>{formatDate(version.submitted_at)}</dd>
        </div>
        <div>
          <dt>{c("workspace.record.versionId")}</dt>
          <dd>{version.id}</dd>
        </div>
      </dl>
      <table className={[uiStyles["ui-table"], appStyles["mt-5"]].join(" ")}>
        <tbody>
          {Object.entries(version.entries).map(([key, value]) => (
            <tr key={key}>
              <th scope="row">{fieldLabel(key)}</th>
              <td>
                {value === null
                  ? c("workspace.field.null")
                  : typeof value === "boolean"
                    ? value
                      ? c("workspace.field.done")
                      : c("workspace.field.notDone")
                    : typeof value === "number" ? formatNumber(value) : String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
