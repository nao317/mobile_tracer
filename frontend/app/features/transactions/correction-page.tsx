import { Alert, Panel, TextField } from "../../components/ui/primitives";
import type { Transaction } from "./model";
import { TransactionForm } from "./shared";
export function CorrectionPage({
  item,
  csrf,
}: {
  item: Transaction;
  csrf: string;
}) {
  return item.can_manage && item.content.version.status !== "draft" ? (
    <Panel title="訂正版を作成">
      <Alert>
        元の記録と回答・登録結果を保持して、新しい下書きを作成します。写真の保存と顧客の再承認が必要です。
      </Alert>
      <TransactionForm intent="correct" csrf={csrf}>
        <TextField
          id="reason"
          name="reason"
          label="訂正・再提示の理由"
          maxLength={2000}
          required
        />
      </TransactionForm>
    </Panel>
  ) : (
    <Alert>提出済みの版を選択してください。</Alert>
  );
}
