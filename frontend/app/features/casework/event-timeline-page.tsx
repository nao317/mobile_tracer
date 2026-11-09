import { Link } from "react-router";
import {
  Alert,
  Badge,
  Field,
  Panel,
  Textarea,
} from "../../components/ui/primitives";
import { useI18n } from "../../components/ui/display-settings";
import { CaseworkForm, ReviewFields } from "./shared";
import { labels, type Casework, type EventView } from "./model";
export function EventTimelinePage({
  item,
  csrf,
  userID,
  requestKey,
  now,
}: {
  item: Casework;
  csrf: string;
  userID: string;
  requestKey: string;
  now: number;
}) {
  const base = `/casework/${item.case.id}`;
  return (
    <>
      {item.case.status === "in_progress" ? (
        <Panel title="新しい提案・報告">
          <div>
            {item.can_manage ? (
              <>
                <Link to={base + "/work"}>作業を提案</Link> /{" "}
                <Link to={base + "/report"}>進捗を報告</Link>
              </>
            ) : item.start.customer_id === userID ? (
              <>
                <Link to={base + "/incident"}>インシデントを報告</Link> /{" "}
                <Link to={base + "/request"}>対応を依頼</Link>
              </>
            ) : null}
          </div>
        </Panel>
      ) : (
        <Alert>案件開始の承認待ちです。</Alert>
      )}
      {item.events.map((row) => (
        <EventCard
          key={row.event.id}
          row={row}
          item={item}
          csrf={csrf}
          userID={userID}
          requestKey={requestKey}
          now={now}
        />
      ))}
      {!item.events.length && <p>イベントはまだありません。</p>}
    </>
  );
}
function EventCard({
  row,
  item,
  csrf,
  userID,
  requestKey,
  now,
}: {
  row: EventView;
  item: Casework;
  csrf: string;
  userID: string;
  requestKey: string;
  now: number;
}) {
  const { formatDate, formatNumber } = useI18n();
  const e = row.event;
  const open = item.case.status === "in_progress" && !row.superseded;
  const reviewer =
    (e.origin === "business" &&
      item.start.customer_id === userID &&
      e.actor_id !== userID) ||
    (e.origin === "customer" && item.can_manage && e.actor_id !== userID);
  const canReview =
    open && reviewer && row.state === "pending" && Date.parse(e.deadline) > now;
  const author = e.actor_id === userID;
  const revise =
    open &&
    author &&
    ["pending", "rejected", "held", "returned"].includes(row.state);
  const path = e.kind === "progress_report" ? "report" : e.kind;
  return (
    <Panel title={`${labels[e.kind]}：${e.title}`}>
      <Badge>
        {row.superseded ? "新版あり" : (labels[row.state] ?? row.state)}
      </Badge>
      <p style={{ whiteSpace: "pre-wrap" }}>{e.description}</p>
      {e.amount_minor !== null && <p>金額：{formatNumber(e.amount_minor)}円</p>}
      {e.target_stage && <p>着手時の移行先：{e.target_stage}</p>}
      <p>
        回答期限：{formatDate(e.deadline)}
        {row.state === "pending" && Date.parse(e.deadline) < now
          ? "（期限超過）"
          : ""}
      </p>
      {row.actions.map((action) => (
        <blockquote key={action.id}>
          <p>
            {labels[action.action] ?? action.action}：
            {formatDate(action.created_at)}
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>{action.detail}</p>
        </blockquote>
      ))}
      {canReview && (
        <CaseworkForm
          intent="event-action"
          csrf={csrf}
          requestKey={`${requestKey}`}
          label="相手への回答を保存する"
        >
          <input type="hidden" name="event_id" value={e.id} />
          <ReviewFields allowReturn prefix={e.id} />
        </CaseworkForm>
      )}
      {open &&
        item.can_manage &&
        row.state === "approved" &&
        e.kind !== "progress_report" && (
          <ActionForm
            eventID={e.id}
            csrf={csrf}
            requestKey={requestKey}
            action="executed"
            label="承認済みの範囲に着手する"
          />
        )}
      {open && item.can_manage && row.state === "in_progress" && (
        <ActionForm
          eventID={e.id}
          csrf={csrf}
          requestKey={requestKey}
          action="reported"
          label="対応結果を顧客へ報告する"
          detail
        />
      )}
      {open &&
        item.start.customer_id === userID &&
        row.state === "awaiting_completion" && (
          <ActionForm
            eventID={e.id}
            csrf={csrf}
            requestKey={requestKey}
            action="completed"
            label="対応の完了を確認する"
          />
        )}
      {revise && (
        <Link to={`/casework/${item.case.id}/${path}?supersedes=${e.id}`}>
          内容を新しい版として再提示する
        </Link>
      )}
      {item.can_manage && e.origin === "customer" && !row.superseded && (
        <p>
          <Link to={`/casework/${item.case.id}/work?parent=${e.id}`}>
            この報告・依頼に関連する作業を提案
          </Link>
        </p>
      )}
    </Panel>
  );
}
function ActionForm({
  eventID,
  csrf,
  requestKey,
  action,
  label,
  detail = false,
}: {
  eventID: string;
  csrf: string;
  requestKey: string;
  action: string;
  label: string;
  detail?: boolean;
}) {
  return (
    <CaseworkForm
      intent="event-action"
      csrf={csrf}
      requestKey={requestKey}
      label={label}
    >
      <input type="hidden" name="event_id" value={eventID} />
      <input type="hidden" name="action" value={action} />
      {detail && (
        <Field id={`detail-${eventID}`} label="対応結果">
          <Textarea
            id={`detail-${eventID}`}
            name="detail"
            required
            maxLength={8000}
          />
        </Field>
      )}
      <label>
        <input type="checkbox" name="confirmed" value="1" required />
        対象の内容を確認しました
      </label>
    </CaseworkForm>
  );
}
