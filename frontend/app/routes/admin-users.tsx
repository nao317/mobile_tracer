import { createTranslator } from "../i18n";
import { routeLocale } from "../i18n/route-locale";
import { useI18n } from "../components/ui/display-settings";
import uiStyles from "../components/ui/ui.module.css";
import { ManagementLink as Link } from "../features/management/navigation";
import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-users";
import { managementRevalidate } from "../features/management/model";
import { PageHeader } from "../components/ui/primitives";
import { sessionHeaders } from "../lib/auth.server";
import {
  managementSession,
  managementRead,
  managementReadPage,
  managementWrite,
  managementQuery,
  validID,
  formString,
} from "../features/management/api.server";
import {
  managedUserSchema,
  companySchema,
  usersPageSchema,
  type ManagementResult,
} from "../features/management/model";
import { ActionNotice } from "../features/management/shared";

export const headers = sessionHeaders;
export const shouldRevalidate = managementRevalidate;
export function meta({ matches }: Route.MetaArgs) {
  return [{ title: `${createTranslator(routeLocale(matches))("navigation.users")} | Mobile Tracer` }];
}
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await managementSession(request, true),
    search = new URL(request.url).searchParams,
    selected = search.get("user");
  const view = selected ? (search.get("view") || "detail") : "list";
  if (!["list", "detail", "edit"].includes(view)) throw new Response("対象が見つかりません。", { status: 404, headers: auth.headers });
  const [page, detail] = await Promise.all([
    view === "list" ? managementReadPage(
      request,
      auth,
      `/api/admin/users?${managementQuery(request, ["account_type"])}`,
      usersPageSchema,
    ) : null,
    selected
      ? managementRead(
          request,
          auth,
          `/api/admin/users/${validID(selected)}`,
          z.object({
            data: z.object({
              user: managedUserSchema,
              companies: z.array(companySchema),
            }),
          }),
        )
      : Promise.resolve(null),
  ]);
  return data(
    {
      view,
      page,
      detail: detail?.data ?? null,
      csrf: auth.session.csrf_token,
      self: auth.session.user.id,
    },
    { headers: auth.headers },
  );
}
export async function action({ request }: Route.ActionArgs) {
  const auth = await managementSession(request, true),
    form = await request.formData();
  if (formString(form, "intent") !== "updateUser")
    return data<ManagementResult>(
      { code: "validation", error: "操作を確認してください。" },
      { status: 400, headers: auth.headers },
    );
  const parsed = z
    .object({
      account_type: z.enum(["general", "business"]),
      status: z.enum(["active", "suspended"]),
      display_name: z.string().max(200),
      version: z.coerce.number().int().nonnegative(),
    })
    .safeParse(
      Object.fromEntries(
        ["account_type", "status", "display_name", "version"].map((key) => [
          key,
          formString(form, key),
        ]),
      ),
    );
  if (!parsed.success)
    return data<ManagementResult>(
      { code: "validation", error: "入力内容を確認してください。" },
      { status: 400, headers: auth.headers },
    );
  return managementWrite(
    request,
    auth,
    `/api/admin/users/${validID(formString(form, "user_id"))}`,
    formString(form, "_csrf"),
    parsed.data,
    "PATCH",
  );
}

import { UserListPage, UserDetailPage, UserEditPage } from "../features/management/user-pages";
export default function AdminUsers({ loaderData, actionData }: Route.ComponentProps) { const i18n = useI18n();
  const { view, page, detail, csrf, self } = loaderData;
  return <div className={uiStyles["ui-stack"]}><PageHeader title={i18n.t("management.userManagement")} /><ActionNotice result={actionData} />
  {detail && <div className={uiStyles["ui-actions"]}>
    <Link className={uiStyles["ui-text-link"]} to="/admin/users">{i18n.t("management.backToUsers")}</Link>
    <Link className={uiStyles["ui-text-link"]} to={`?user=${detail.user.id}&view=detail`}>{i18n.t("management.userDetails")}</Link>
    <Link className={uiStyles["ui-text-link"]} to={`?user=${detail.user.id}&view=edit`}>{i18n.t("management.editUser")}</Link>
  </div>}
  {view === "list" && page && <UserListPage page={page} />}
  {view === "detail" && detail && <UserDetailPage detail={detail} />}
  {view === "edit" && detail && <UserEditPage detail={detail} csrf={csrf} self={self} />}
  </div>;
}
