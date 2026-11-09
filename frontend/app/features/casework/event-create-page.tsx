import {
  Alert,
  Field,
  Panel,
  TextField,
  Select,
  Textarea,
} from "../../components/ui/primitives";
import { CaseworkForm, CaseworkBack } from "./shared";
import { labels, type Casework } from "./model";
export function EventCreatePage({
  item,
  kind,
  csrf,
  requestKey,
  supersedesID,
  parentID,
  canCustomer,
}: {
  item: Casework;
  kind: "work" | "progress_report" | "incident" | "request";
  csrf: string;
  requestKey: string;
  supersedesID?: string;
  parentID?: string;
  canCustomer: boolean;
}) {
  const business = kind === "work" || kind === "progress_report";
  const source = item.events.find((e) => e.event.id === supersedesID)?.event;
  if (item.case.status !== "in_progress")
    return <Alert>案件開始の顧客承認が必要です。</Alert>;
  if ((business && !item.can_manage) || (!business && !canCustomer))
    return <Alert>この起票操作の権限がありません。</Alert>;
  return (
    <>
      <CaseworkBack caseID={item.case.id} />
      <Panel title={labels[kind]}>
        <p>
          {kind === "work"
            ? "顧客の承認後に着手できます。範囲・金額・段階変更の内容を明示してください。"
            : kind === "progress_report"
              ? "報告内容を顧客に提示して、確認を求めます。"
              : "業者に内容を提示し、受理・承認を求めます。対応後にはご自身で完了を確認できます。"}
        </p>
        <CaseworkForm
          intent="event"
          csrf={csrf}
          requestKey={requestKey}
          label="内容を固定して相手へ提示する"
        >
          <input type="hidden" name="kind" value={kind} />
          {supersedesID && (
            <input type="hidden" name="supersedes_id" value={supersedesID} />
          )}
          {parentID && (
            <input type="hidden" name="parent_event_id" value={parentID} />
          )}
          <TextField
            id="title"
            name="title"
            label="件名"
            maxLength={200}
            defaultValue={source?.title}
            required
          />
          <Field id="description" label="内容・対象範囲">
            <Textarea
              id="description"
              name="description"
              maxLength={8000}
              defaultValue={source?.description}
              required
            />
          </Field>
          {kind === "work" && (
            <>
              <TextField
                id="amount"
                name="amount_minor"
                label="金額（円・整数、任意）"
                type="number"
                min={0}
                step={1}
                defaultValue={source?.amount_minor ?? undefined}
              />
              <Field id="target" label="着手時に進める段階（任意）">
                <Select
                  id="target"
                  name="target_stage"
                  defaultValue={source?.target_stage ?? ""}
                >
                  <option value="">段階を変更しない</option>
                  {item.next_stages.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <TextField
            id="deadline"
            name="deadline"
            label="相手の回答期限"
            type="datetime-local"
            required
          />
        </CaseworkForm>
      </Panel>
    </>
  );
}
