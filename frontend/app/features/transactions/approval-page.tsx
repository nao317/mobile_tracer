import { Alert, Field, Panel, Select } from "../../components/ui/primitives";
import type { Transaction } from "./model";
import { labels } from "./model";
import { TransactionForm } from "./shared";
export function ApprovalPage({
  item,
  csrf,
  userID,
  now,
}: {
  item: Transaction;
  csrf: string;
  userID: string;
  now: number;
}) {
  return (
    <>
      <Alert>
        閲覧・受領・状態同意・作業承認は別の回答です。回答はこの版と表示された確認文面に対して保存されます。拒否・保留後の再確認には業者による新しい版の提示が必要です。
      </Alert>
      {item.requests.map((q) => (
        <Panel key={q.id} title={labels[q.kind] ?? q.kind}>
          <p style={{ whiteSpace: "pre-wrap" }}>{q.statement}</p>
          <p>回答期限：{q.deadline}</p>
          <p>
            回答：
            {q.decision
              ? labels[q.decision]
              : Date.parse(q.deadline) < now
                ? "期限超過"
                : "未回答"}{" "}
            / {q.responded_at ?? "―"}
          </p>
          {q.user_id === userID &&
            !q.decision &&
            Date.parse(q.deadline) > now && (
              <TransactionForm intent="respond" csrf={csrf}>
                <input type="hidden" name="request_id" value={q.id} />
                <Field id={`decision-${q.id}`} label="回答">
                  <Select id={`decision-${q.id}`} name="decision">
                    <option value="approved">
                      {q.kind === "view"
                        ? "閲覧しました"
                        : q.kind === "receipt"
                          ? "受領しました"
                          : "承認します"}
                    </option>
                    <option value="rejected">拒否します</option>
                    <option value="held">保留します</option>
                  </Select>
                </Field>
                <label>
                  <input type="checkbox" name="confirmed" value="1" required />
                  対象の記録・写真・確認文面を確認しました
                </label>
              </TransactionForm>
            )}
        </Panel>
      ))}
      {!item.requests.length && <p>顧客への提示前です。</p>}
    </>
  );
}
