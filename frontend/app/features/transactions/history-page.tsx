import { Link } from "react-router";
import {
  Field,
  Panel,
  Select,
  TextField,
} from "../../components/ui/primitives";
import type { Transaction } from "./model";
import { TransactionForm } from "./shared";
export function HistoryPage({
  item,
  csrf,
  owners,
}: {
  item: Transaction;
  csrf: string;
  owners: {
    id: string;
    user_id: string;
    effective_at: string;
  }[];
}) {
  const ownersToChoose = item.requests.filter(
    (q) =>
      q.qualification === "owner" &&
      q.kind === "state_agreement" &&
      q.decision === "approved",
  );
  return (
    <>
      <Panel title="車両の取引履歴">
        <Link to={`/transactions?vehicle_id=${item.content.vehicle.id}`}>
          この車両の参照可能な取引・記録版を表示
        </Link>
      </Panel>
      <Panel title="所有者の変更履歴">
        {owners.map((o) => (
          <p key={o.id}>
            {o.effective_at}：{o.user_id}
          </p>
        ))}
        {!owners.length && <p>参照可能な所有者変更はありません。</p>}
        {item.can_manage && ownersToChoose.length > 0 && (
          <TransactionForm intent="ownership" csrf={csrf}>
            <Field id="owner" label="本人が承認済みの所有者">
              <Select id="owner" name="user_id">
                {ownersToChoose.map((q) => (
                  <option key={q.id} value={q.user_id}>
                    {q.user_id}
                  </option>
                ))}
              </Select>
            </Field>
            <TextField
              id="effective"
              name="effective_at"
              label="所有権変更の有効日時"
              type="datetime-local"
              required
            />
          </TransactionForm>
        )}
      </Panel>
      <Panel title="個人情報を除いた履歴の共有">
        <p>
          共有するのは車種、版番号、記録日時、走行距離・燃料・見積金額（数値項目のみ）、登録ハッシュです。写真・自由記述・氏名・所有者情報は共有しません。
        </p>
        <TransactionForm intent="share" csrf={csrf}>
          <TextField
            id="share-email"
            name="email"
            type="email"
            label="共有先の登録メールアドレス"
            required
          />
          <TextField
            id="share-expiry"
            name="expires_at"
            type="datetime-local"
            label="共有期限"
            required
          />
        </TransactionForm>
        <Link to="/history-shares">共有履歴と受け入れ</Link>
      </Panel>
    </>
  );
}
