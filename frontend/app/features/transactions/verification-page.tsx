import { Alert, Panel } from "../../components/ui/primitives";
import type { Transaction } from "./model";
import { labels } from "./model";
import { TransactionForm } from "./shared";
export function VerificationPage({
  item,
  csrf,
  result,
}: {
  item: Transaction;
  csrf: string;
  result?: string;
}) {
  return (
    <>
      {!item.api_configured&&<Alert tone="warning">Tapyrus APIの接続設定が未完了です。登録待ちの内容は設定後に処理されます。</Alert>}
      <Panel title="チェーン登録">
        <p>
          状態：
          {item.anchor
            ? labels[item.anchor.status]
            : "未登録（顧客承認待ち、または提示前）"}
        </p>
        {item.anchor && (
          <>
            <p>
              トランザクションID：
              <code style={{ overflowWrap: "anywhere" }}>
                {item.anchor.txid ?? "未作成"}
              </code>
            </p>
            <p>登録日時：{item.anchor.registered_at ?? "未確定"}</p>
            <p>試行回数：{item.anchor.attempts}</p>
            <p>
              登録ハッシュ：
              <code style={{ overflowWrap: "anywhere" }}>
                {item.anchor.manifest_hash}
              </code>
            </p>
          </>
        )}
        {item.can_manage &&
          item.anchor?.status !== "registered" &&
          item.requests.length > 0 &&
          item.requests.every((request) => request.decision === "approved") && (
            <TransactionForm intent="retry" csrf={csrf}>
              <p>
                未登録の承認済み記録を登録キューへ追加します。送信後は同じトランザクションを再試行します。
              </p>
            </TransactionForm>
          )}
      </Panel>
      <Panel title="改ざん検証">
        <TransactionForm intent="verify" csrf={csrf}>
          <p>
            保存済みの原本・記録・承認情報と、チェーンに登録されたハッシュを照合します。
          </p>
        </TransactionForm>
        {result && (
          <Alert
            tone={
              result === "match"
                ? "success"
                : result === "mismatch"
                  ? "danger"
                  : "warning"
            }
          >
            {labels[result]}
          </Alert>
        )}
      </Panel>
      <Alert>
        登録・照合は、撮影内容の真実性や責任の所在を保証するものではありません。
      </Alert>
    </>
  );
}
