import { useState } from "react";
import {
  Field,
  Panel,
  Select,
  TextField,
  Textarea,
  Button,
  Alert,
} from "../../components/ui/primitives";
import type { Transaction } from "./model";
import { TransactionForm } from "./shared";
export function PresentationPage({
  item,
  csrf,
  requestKey,
}: {
  item: Transaction;
  csrf: string;
  requestKey: string;
}) {
  const [count, setCount] = useState(1);
  if (!item.can_manage || item.content.version.status !== "draft")
    return <Alert>提出済み、または提示権限がありません。</Alert>;
  return (
    <Panel title="顧客へ提示">
      <p>
        保存済みの内容と写真を固定し、以下の一般ユーザーに提示します。すべての回答が承認となり、状態同意または作業承認が含まれるとチェーン登録が始まります。
      </p>
      <TransactionForm intent="present" csrf={csrf}>
        <input type="hidden" name="request_key" value={requestKey} />
        <input
          type="hidden"
          name="lock_version"
          value={item.content.version.lock_version}
        />
        <input type="hidden" name="recipient_count" value={count} />
        {Array.from({ length: count }, (_, index) => (
          <Panel key={index} title={`確認先 ${index + 1}`}>
            <TextField
              id={`email-${index}`}
              name={`email-${index}`}
              label="顧客の登録メールアドレス"
              type="email"
              required
            />
            <Field id={`qualification-${index}`} label="資格">
              <Select
                id={`qualification-${index}`}
                name={`qualification-${index}`}
              >
                <option value="owner">所有者</option>
                <option value="renter">借受人</option>
                <option value="purchaser">購入者</option>
                <option value="repair_requester">修理依頼者</option>
                <option value="approver">承認者</option>
              </Select>
            </Field>
            <Field id={`kind-${index}`} label="確認種別">
              <Select
                id={`kind-${index}`}
                name={`kind-${index}`}
                defaultValue="state_agreement"
              >
                <option value="view">閲覧</option>
                <option value="receipt">受領</option>
                <option value="state_agreement">状態同意</option>
                <option value="work_authorization">作業承認</option>
              </Select>
            </Field>
            <Field
              id={`statement-${index}`}
              label="確認文面・承認対象の範囲と金額"
            >
              <Textarea
                id={`statement-${index}`}
                name={`statement-${index}`}
                maxLength={4000}
                required
              />
            </Field>
            <TextField
              id={`deadline-${index}`}
              name={`deadline-${index}`}
              label="回答期限"
              type="datetime-local"
              required
            />
          </Panel>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={count >= 20}
          onClick={() => setCount(count + 1)}
        >
          確認先を追加
        </Button>
      </TransactionForm>
    </Panel>
  );
}
