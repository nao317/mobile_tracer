import { useI18n } from "../../components/ui/display-settings";
export function SharedHistory({
  content,
}: {
  content: Record<string, unknown>;
}) {
  const { formatDate, formatNumber } = useI18n();
  const condition =
    content.condition && typeof content.condition === "object"
      ? (content.condition as Record<string, unknown>)
      : {};
  const labels: Record<string, string> = {
    odometer: "走行距離",
    fuel_level: "燃料残量",
    estimate: "見積金額",
  };
  return (
    <dl>
      <div>
        <dt>車種</dt>
        <dd>{String(content.model_name ?? "未登録")}</dd>
      </div>
      <div>
        <dt>記録版</dt>
        <dd>第{String(content.version_no)}版</dd>
      </div>
      <div>
        <dt>記録日時</dt>
        <dd>{formatDate(String(content.recorded_at))}</dd>
      </div>
      {Object.entries(condition).map(([key, value]) => (
        <div key={key}>
          <dt>{labels[key] ?? key}</dt>
          <dd>{typeof value === "number" ? formatNumber(value) : "―"}</dd>
        </div>
      ))}
      <div>
        <dt>登録トランザクション</dt>
        <dd style={{ overflowWrap: "anywhere" }}>
          {String(content.txid ?? "―")}
        </dd>
      </div>
      <div>
        <dt>登録ハッシュ</dt>
        <dd style={{ overflowWrap: "anywhere" }}>
          {String(content.manifest_hash ?? "―")}
        </dd>
      </div>
    </dl>
  );
}
