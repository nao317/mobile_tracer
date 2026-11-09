import { Alert, Panel } from "../../components/ui/primitives";
import { CaseworkForm } from "./shared";
import { labels, type Casework } from "./model";
export function CaseVerificationPage({
  item,
  csrf,
  requestKey,
  result,
}: {
  item: Casework;
  csrf: string;
  requestKey: string;
  result?: string;
}) {
  return (
    <>
      {!item.api_configured && (
        <Alert tone="warning">
          Tapyrus
          APIの接続設定が未完了です。承認内容は保存され、設定後に登録処理が進みます。
        </Alert>
      )}
      {item.registrations.map((job) => (
        <Panel
          key={job.id}
          title={labels[job.subject_type] ?? job.subject_type}
        >
          <p>状態：{labels[job.status] ?? job.status}</p>
          <p>Timestamp ID：{job.timestamp_id ?? "未取得"}</p>
          <p style={{ overflowWrap: "anywhere" }}>
            トランザクション：{job.txid ?? "未取得"}
          </p>
          <p style={{ overflowWrap: "anywhere" }}>
            登録ハッシュ：{job.manifest_hash}
          </p>
          <p>確定日時：{job.confirmed_at ?? "未確定"}</p>
          <CaseworkForm
            csrf={csrf}
            intent="verify"
            requestKey={requestKey}
            label="保存内容とAPI登録値を照合する"
          >
            <input type="hidden" name="registration_id" value={job.id} />
          </CaseworkForm>
        </Panel>
      ))}
      {!item.registrations.length && <p>登録対象の承認はまだありません。</p>}
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
          {labels[result] ?? result}
        </Alert>
      )}
      <Alert>
        登録・照合は、報告内容の真実性や責任の所在を保証するものではありません。
      </Alert>
    </>
  );
}
