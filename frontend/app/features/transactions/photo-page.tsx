import { Panel, Alert } from "../../components/ui/primitives";
import type { Transaction } from "./model";
import { TransactionForm } from "./shared";
import { Link } from "react-router";
import { photoPositions } from "../workspace/preview-data";
import { PhotoCaptureFields } from "./photo-capture-fields";
export function PhotoPage({
  item,
  csrf,
  requestKey,
}: {
  item: Transaction;
  csrf: string;
  requestKey: string;
}) {
  const { content, can_manage } = item;
  return (
    <>
      <Panel title="保存した原本">
        {content.media.map((photo) => (
          <figure key={photo.id}>
            <img
              src={`/api/transactions/${content.version.id}/media/${photo.id}`}
              alt={photo.position}
              style={{ maxWidth: "100%", maxHeight: 320 }}
            />
            <figcaption>
              {photo.position} / 受信日時：{photo.created_at}
              <br />
              撮影日時：{photo.device_captured_at ?? "端末申告なし"}
              <br />
              撮影場所：{photo.location_label ?? "場所の記録なし"}
              <br />
              SHA-256：
              <code>{photo.sha256}</code>
            </figcaption>
          </figure>
        ))}
        {!content.media.length && <p>写真はまだありません。</p>}
      </Panel>
      {can_manage && content.case.status === "awaiting_customer" && (
        <Alert>
          顧客の開始承認待ちです。画像は案件が進行中になってから保存できます。
          <Link to={`/casework/new?case=${content.case.id}`}>
            案件開始の条件を顧客へ提示する
          </Link>
        </Alert>
      )}
      {can_manage &&
        (content.case.status === "completed" ||
          content.case.status === "cancelled") && (
          <Alert>完了・中止した案件には画像を追加できません。</Alert>
        )}
      {can_manage &&
        content.case.status === "in_progress" &&
        content.version.status === "draft" && (
          <Panel title="写真を撮影・保存">
            <TransactionForm intent="photo" csrf={csrf} multipart>
              <input type="hidden" name="request_key" value={requestKey} />
              <PhotoCaptureFields positions={photoPositions[content.case.case_type]} />
            </TransactionForm>
          </Panel>
        )}
    </>
  );
}
