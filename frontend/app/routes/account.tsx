import { createTranslator } from "../i18n";
import { routeLocale } from "../i18n/route-locale";
import { useI18n } from "../components/ui/display-settings";
import uiStyles from "../components/ui/ui.module.css";
import { data, Form, redirect } from "react-router";
import { z } from "zod";

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
export function meta({ matches }: Route.MetaArgs) {
  return [{ title: `${createTranslator(routeLocale(matches))("navigation.account")} | Mobile Tracer` }];
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
}: Route.ComponentProps) { const i18n = useI18n();
  const { session, roles } = loaderData;
  return (
    <div className={uiStyles["ui-stack"]}>
      <PageHeader title={i18n.t("management.account")} />
      <p>
        {i18n.t("management.accountTypeLabel")}{i18n.enumLabel("accountType", session.user.account_type ?? "general")}
      </p>
      {actionData?.error && <Alert tone="danger">{i18n.errorMessage(undefined)}</Alert>}
      <Panel title={i18n.t("management.workMembership")}>
        {session.memberships.length ? (
          <Form method="post" className={uiStyles["ui-form"]}>
            <input type="hidden" name="intent" value="membership" />
            <input type="hidden" name="_csrf" value={session.csrf_token} />
            <Field id="membership" label={i18n.t("management.membershipStaff")}>
              <Select
                id="membership"
                name="staff_id"
                defaultValue={session.selected_staff_id || ""}
                required
              >
                <option value="" disabled>
                  {i18n.t("management.selectMembership")}</option>
                {session.memberships.map((m) => (
                  <option value={m.staff_id} key={m.staff_id}>
                    {m.tenant_name} / {m.display_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit">{i18n.t("management.useMembership")}</Button>
          </Form>
        ) : (
          <p>
            {i18n.t("management.noWorkMembership")}{session.user.account_type === "business"
              ? i18n.t("management.businessMembershipHelp")
              : i18n.t("management.generalMembershipHelp")}
          </p>
        )}
        {!!roles.length && (
          <p>
            {i18n.t("management.currentRolesLabel")}{i18n.formatList(roles.map((role) => i18n.enumLabel("role", role)))}
          </p>
        )}
      </Panel>
      {session.selected_staff_id && roles.length > 0 && (
        <a href="/app" className={uiStyles["ui-link-button"]}>
          {i18n.t("management.openWorkspace")}</a>
      )}
      <a href="/casework" className={uiStyles["ui-link-button"]}>案件・報告・依頼</a>
      <a href="/transactions" className={uiStyles["ui-link-button"]}>取引・車両情報の確認</a>
      <a href="/history-shares" className={uiStyles["ui-text-link"]}>共有された車両履歴</a>
      <a href={session.user.account_type === "business" ? "/account/requests?view=companies" : "/account/requests?view=upgrade"} className={uiStyles["ui-link-button"]}>
        {session.user.account_type === "business"
          ? i18n.t("management.manageMyApplications")
          : i18n.t("management.applyUpgrade")}
      </a>
    </div>
  );
}
