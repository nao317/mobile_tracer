import { SharedHistory } from "../features/transactions/shared-history";
import uiStyles from "../components/ui/ui.module.css";
import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/history-shares";
import { requireSession, sessionHeaders } from "../lib/auth.server";
import {
  managementRead,
  managementWrite,
  validID,
} from "../features/management/api.server";
import { TransactionForm } from "../features/transactions/shared";
import { Alert, PageHeader, Panel } from "../components/ui/primitives";
import { AuthenticatedLayout } from "../components/templates/authenticated-layout";
const schema = z.object({
  data: z.array(
    z.object({
      share: z.object({
        id: z.string(),
        sender_id: z.string(),
        recipient_id: z.string(),
        expires_at: z.string(),
        accepted_at: z.string().nullable(),
        revoked_at: z.string().nullable(),
      }),
      content: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
});
export const headers = sessionHeaders;
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireSession(request);
  const result = await managementRead(
    request,
    auth,
    "/api/transactions/shares",
    schema,
  );
  return data(
    { ...result, session: auth.session, now: Date.now() },
    { headers: auth.headers },
  );
}
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireSession(request),
    form = await request.formData();
  const operation = String(form.get("intent"));
  if (!["accept", "revoke"].includes(operation))
    throw new Response("操作を確認してください。", { status: 400 });
  return managementWrite(
    request,
    auth,
    `/api/transactions/shares/${validID(String(form.get("share_id")))}/${operation}`,
    String(form.get("_csrf")),
    {},
  );
}
export default function HistoryShares({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <AuthenticatedLayout
      session={loaderData.session}
      title="履歴の共有"
      groups={[
        {
          id: "history",
          label: "履歴",
          items: [
            { id: "shares", label: "共有履歴", to: "/history-shares" },
            { id: "transactions", label: "取引一覧", to: "/transactions" },
          ],
        },
      ]}
    >
      <div className={uiStyles["ui-stack"]}>
        <PageHeader title="履歴の共有と受け入れ" />
        {actionData?.error && <Alert tone="danger">{actionData.error}</Alert>}
        {loaderData.data.map(({ share, content }) => (
          <Panel
            key={share.id}
            title={
              share.sender_id === loaderData.session.user.id
                ? "送信した履歴"
                : "受信した履歴"
            }
          >
            <p>
              期限：{share.expires_at} /{" "}
              {share.revoked_at
                ? "取消済み"
                : Date.parse(share.expires_at) < loaderData.now
                  ? "期限終了"
                  : share.accepted_at
                    ? "受入済み"
                    : "受入待ち"}
            </p>
            {content && <SharedHistory content={content} />}
            {!share.revoked_at &&
              (share.sender_id === loaderData.session.user.id ||
                (!share.accepted_at &&
                  Date.parse(share.expires_at) > loaderData.now)) && (
                <TransactionForm
                  csrf={loaderData.session.csrf_token}
                  intent={
                    share.sender_id === loaderData.session.user.id
                      ? "revoke"
                      : "accept"
                  }
                >
                  <input type="hidden" name="share_id" value={share.id} />
                  <p>
                    {share.sender_id === loaderData.session.user.id
                      ? "共有を取り消します。"
                      : "この共有を受け入れ、公開範囲内の履歴を閲覧します。"}
                  </p>
                </TransactionForm>
              )}
          </Panel>
        ))}
      </div>
    </AuthenticatedLayout>
  );
}
