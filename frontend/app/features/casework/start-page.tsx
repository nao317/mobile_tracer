import { Link } from "react-router";
import { Alert, Badge, Panel } from "../../components/ui/primitives";
import { CaseworkForm, ReviewFields } from "./shared";
import { labels, type Casework } from "./model";
import { useI18n } from "../../components/ui/display-settings";
export function StartPage({
  item,
  csrf,
  requestKey,
  userID,
  now,
}: {
  item: Casework;
  csrf: string;
  requestKey: string;
  userID: string;
  now: number;
}) {
  const { formatDate } = useI18n();
  const start = item.start;
  return (
    <>
      <Panel title="案件開始の条件">
        <Badge>{labels[item.case.status]}</Badge>
        <p>
          業者：{item.terms.company_name || "担当業者"} / 店舗：
          {item.terms.store_name || "担当店舗"}
        </p>
        <p>車両：{item.vehicle.model_name ?? "未登録"}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{item.terms.terms}</p>
        <p>
          条件の版：{start.version_no} / 回答期限：{formatDate(start.deadline)}
        </p>
        <p>
          回答：
          {start.decision
            ? labels[start.decision]
            : Date.parse(start.deadline) < now
              ? "期限超過"
              : "未回答"}
        </p>
        {start.customer_id === userID &&
          !start.decision &&
          item.case.status === "awaiting_customer" &&
          Date.parse(start.deadline) > now && (
            <CaseworkForm
              intent="start-response"
              csrf={csrf}
              requestKey={requestKey}
              label="案件開始への回答を保存する"
            >
              <input type="hidden" name="start_id" value={start.id} />
              <ReviewFields />
            </CaseworkForm>
          )}
        {item.can_manage && item.case.status === "awaiting_customer" && (
          <Link to={`/casework/new?case=${item.case.id}`}>
            条件を新しい版として再提示する
          </Link>
        )}
      </Panel>
      <Alert>
        顧客が承認するまで、この案件での作業提案・進行報告・記録の作成は開始できません。拒否・保留・期限超過は案件成立として扱いません。
      </Alert>
    </>
  );
}
