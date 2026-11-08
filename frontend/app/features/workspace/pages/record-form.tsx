import { CoreBackLink } from "./navigation";
import workspaceStyles from "../workspace.module.css";
import appStyles from "../../../app.module.css";
import uiStyles from "../../../components/ui/ui.module.css";
import { useCoreI18n } from "./core-messages";

import { useSearchParams } from "react-router";
import { CoreLink as Link } from "./navigation";
import { useState } from "react";
import { Alert, EmptyState, Field, Input, Panel, Select, Textarea } from "../../../components/ui/primitives";
import { canWrite, rulesFor, type BusinessCase, type FieldRule, type Version } from "../model";
import { CommandForm, CommandSubmit } from "../command-form";
import { useWorkspace } from "../workspace-context";

import { selectedVersion } from "./shared";
export function RecordFormScreen({
  item,
  recordId,
}: {
  item: BusinessCase;
  recordId?: string;
}) {
  const { c } = useCoreI18n();

  const { snapshot, base } = useWorkspace();
  const [search] = useSearchParams();
  const record = snapshot.records.find((r) => r.id === recordId && r.case_id === item.id),
    version = recordId
      ? snapshot.selectedVersion ?? selectedVersion(snapshot.versions.filter(v => v.case_id === item.id), recordId, search.get("version"))
      : undefined;
  const rules = rulesFor(snapshot, item);
  const [kind, setKind] = useState(
    record?.record_kind ?? Object.keys(rules?.record_kinds ?? {})[0] ?? "",
  );
  if (!canWrite(snapshot.context, item))
    return <EmptyState title={c("workspace.access.editRecord")} />;
  if (!rules)
    return (
      <EmptyState title={c("workspace.record.configurationMissing")}>
        {c("workspace.record.editPaused")}</EmptyState>
    );
  if (recordId && (!record || !version || version.record_id !== recordId || version.case_id !== item.id))
    return <EmptyState title={c("workspace.record.missing")} />;
  if (version?.status === "submitted")
    return (
      <EmptyState
        title={c("workspace.record.immutable")}
        actions={
          snapshot.workflow && <Link
            className={uiStyles["ui-link-button"]}
            to={`${base}/cases/${item.id}/records/${recordId}/correct?version=${version.id}`}
          >
            {c("workspace.record.correct")}</Link>
        }
      >
        {c("workspace.record.correctionHint")}</EmptyState>
    );
  return (
    <><CoreBackLink to={`${base}/cases/${item.id}/records`} /><Panel title={recordId ? c("workspace.record.draftVersion", { version: version?.version_no ?? 1 }) : c("workspace.record.create")}>
      <CommandForm
        key={version ? version.id : kind}
        intent={recordId ? "updateDraft" : "createRecord"}
        hidden={{
          caseId: item.id,
          ...(recordId && version
            ? {
              recordId,
              versionId: version.id,
              lock_version: version.lock_version,
            }
            : {}),
        }}
        guard
      >
        {recordId ? (
          <input type="hidden" name="record_kind" value={kind} />
        ) : (
          <Field id="record_kind" label={c("workspace.record.kind")}>
            <Select
              id="record_kind"
              name="record_kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              {Object.keys(rules.record_kinds).map((k) => (
                <option key={k} value={k}>
                  {k === "inspection" ? c("workspace.record.inspection") : k}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Alert>
          {c("workspace.record.draftHint")}</Alert>
        {Object.entries(rules.record_kinds[kind]?.fields ?? {}).map(
          ([key, rule]) => (
            <RecordField
              key={key}
              name={key}
              rule={rule}
              value={version?.entries[key]}
            />
          ),
        )}
        <div className={uiStyles["ui-actions"]}>
          <CommandSubmit>{c("workspace.record.saveDraft")}</CommandSubmit>
          {recordId && version && (
            <Link
              className={uiStyles["ui-text-link"]}
              to={`${base}/cases/${item.id}/records/${recordId}?version=${version.id}`}
            >
              {c("workspace.record.details")}</Link>
          )}
        </div>
      </CommandForm>
    </Panel></>
  );
}

function RecordField({
  name,
  rule,
  value,
}: {
  name: string;
  rule: FieldRule;
  value?: Version["entries"][string];
}) {
  const { c, fieldLabel } = useCoreI18n();

  const id = `entry-${name}`,
    inputName = `entry:${name}`,
    label = `${fieldLabel(name)}${rule.required ? c("workspace.field.requiredSubmission") : ""}`;
  const props = {
    id,
    name: inputName,
    defaultValue: value === null || value === undefined ? "" : String(value),
    "aria-describedby": `${id}-hint`,
  };
  return (
    <div className={[uiStyles["ui-stack"], appStyles["gap-2"]].join(" ")}>
      <Field
        id={id}
        label={label}
        hint={
          rule.type === "integer" || rule.type === "number"
            ? c("workspace.field.range", { min: rule.minimum ?? c("workspace.field.unlimited"), max: rule.maximum ?? c("workspace.field.unlimited") })
            : c("workspace.field.maxLength", { max: rule.max_length ?? c("workspace.field.unlimited") })
        }
      >
        {rule.type === "boolean" ? (
          <Select {...props}>
            <option value="">{c("workspace.field.empty")}</option>
            <option value="true">{c("workspace.field.done")}</option>
            <option value="false">{c("workspace.field.notDone")}</option>
          </Select>
        ) : rule.enum ? (
          <Select {...props}>
            <option value="">{c("workspace.field.unselected")}</option>
            {rule.enum.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        ) : rule.type === "string" ? (
          <Textarea {...props} maxLength={rule.max_length} rows={3} />
        ) : (
          <Input
            {...props}
            type="text"
            inputMode={rule.type === "integer" ? "numeric" : "decimal"}
          />
        )}
      </Field>
      <div className={uiStyles["ui-actions"]}>
        <label className={[workspaceStyles["workspace-check"], uiStyles["ui-hint"]].join(" ")}>
          <input type="checkbox" name={`remove:${name}`} value="1" />
          {c("workspace.field.remove")}</label>
        {rule.nullable && (
          <label className={[workspaceStyles["workspace-check"], uiStyles["ui-hint"]].join(" ")}>
            <input
              type="checkbox"
              name={`null:${name}`}
              value="1"
              defaultChecked={value === null}
            />
            {c("workspace.field.saveNull")}</label>
        )}
      </div>
    </div>
  );
}
