import { data, Form, redirect } from "react-router";
import { z } from "zod";
import { accountLabels } from "../features/management/model";
import { BrandMark } from "../components/ui/display-settings";
import {
  Alert,
  Button,
  Field,
  PageHeader,
  Panel,
  Select,
} from "../components/ui/primitives";
import type { Route } from "./+types/account";
import {
  apiFetch,
  authenticatedPost,
  requireSession,
  sessionHeaders,
} from "../lib/auth.server";

export const headers = sessionHeaders;

const contextSchema = z.object({
  data: z.object({
    principal: z.object({
      roles: z.array(
        z.object({ role: z.string(), store_id: z.string().nullable() }),
      ),
    }),
  }),
});
const roleLabels: Record<string, string> = {
  tenant_admin: "企業管理者",
  store_manager: "店舗責任者",
  staff: "担当者",
  auditor: "監査担当",
};
export function meta() {
  return [{ title: "アカウント | MobilTracer" }];
}
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireSession(request);
  let roles: string[] = [];
  if (auth.session.selected_staff_id) {
    const response = await apiFetch(request, "/api/context", auth.cookie);
    if (response.ok) {
      const result = contextSchema.safeParse(await response.json());
      if (result.success)
        roles = result.data.data.principal.roles.map((r) => r.role);
    } else if (response.status !== 403)
      throw new Response("業務権限を確認できません。", {
        status: 503,
        headers: auth.headers,
      });
  }
  return data({ session: auth.session, roles }, { headers: auth.headers });
}
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = form.get("intent");
  const csrf = String(form.get("_csrf") || "");
  const auth = await requireSession(request);
  if (intent !== "logout" && intent !== "membership")
    throw new Response("操作を確認してください。", {
      status: 400,
      headers: auth.headers,
    });
  const response = await authenticatedPost(
    request,
    auth,
    intent === "logout" ? "/api/auth/logout" : "/api/auth/membership",
    csrf,
    intent === "membership"
      ? { staff_id: String(form.get("staff_id") || "") }
      : {},
  );
  if (!response.ok)
    return data(
      {
        error:
          "操作できませんでした。画面を再読み込みして、もう一度お試しください。",
      },
      { status: response.status, headers: auth.headers },
    );
  return redirect(intent === "logout" ? "/login" : "/account", {
    headers: auth.headers,
  });
}
export default function Account({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { session, roles } = loaderData;
  return (
    <main className="ui-standalone ui-stack">
      <BrandMark />
      <PageHeader title="アカウント" />
      <p>{session.user.email}</p>
      <p>
        ユーザー区分：{accountLabels[session.user.account_type ?? "general"]}
      </p>
      <a href="/account/requests" className="ui-link-button">
        {session.user.account_type === "business"
          ? "企業・自分の申請を管理"
          : "業者ユーザーへの変更を申請"}
      </a>
      {actionData?.error && <Alert tone="danger">{actionData.error}</Alert>}
      <Panel title="業務で利用する所属">
        {session.memberships.length ? (
          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="membership" />
            <input type="hidden" name="_csrf" value={session.csrf_token} />
            <Field id="membership" label="所属・担当者">
              <Select
                id="membership"
                name="staff_id"
                defaultValue={session.selected_staff_id || ""}
                required
              >
                <option value="" disabled>
                  所属を選択してください
                </option>
                {session.memberships.map((m) => (
                  <option value={m.staff_id} key={m.staff_id}>
                    {m.tenant_name} / {m.display_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit">この所属を使う</Button>
          </Form>
        ) : (
          <p>
            利用できる業務所属がありません。
            {session.user.account_type === "business"
              ? "上の申請画面から企業の作成を申請するか、管理者に既存企業への所属追加を依頼してください。"
              : "業務利用には、業者ユーザーへの変更申請の承認と企業への所属が必要です。"}
          </p>
        )}
        {!!roles.length && (
          <p>
            現在の権限：
            {roles.map((role) => roleLabels[role] || role).join("、")}
          </p>
        )}
      </Panel>
      {session.selected_staff_id && roles.length > 0 && (
        <a href="/app" className="ui-link-button">
          業務ワークスペースを開く
        </a>
      )}
      <a href="/" className="ui-text-link">
        ホームへ戻る
      </a>
      {session.system_admin && (
        <a href="/admin" className="block underline">
          システム管理者ページへ
        </a>
      )}
      <Form method="post">
        <input type="hidden" name="intent" value="logout" />
        <input type="hidden" name="_csrf" value={session.csrf_token} />
        <Button type="submit" variant="secondary">
          ログアウト
        </Button>
      </Form>
    </main>
  );
}
