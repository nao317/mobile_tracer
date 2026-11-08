import { createTranslator } from "../i18n";
import { routeLocale } from "../i18n/route-locale";
import { useI18n } from "../components/ui/display-settings";
import uiStyles from "../components/ui/ui.module.css";
import { ManagementLink as Link } from "../features/management/navigation";
import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-requests";
import { managementRevalidate } from "../features/management/model";
import { PageHeader } from "../components/ui/primitives";
import { sessionHeaders } from "../lib/auth.server";
import {
  managementRequestDetail,
  managementSession,
  managementReadPage,
  managementWrite,
  managementQuery,
  validID,
  formString,
} from "../features/management/api.server";
import {
  requestsPageSchema,
  type ManagementResult,
} from "../features/management/model";
import { ActionNotice } from "../features/management/shared";

export const headers = sessionHeaders;
export const shouldRevalidate = managementRevalidate;
export function meta({ matches }: Route.MetaArgs) {
  return [{ title: `${createTranslator(routeLocale(matches))("navigation.review")} | Mobile Tracer` }];
}
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await managementSession(request, true);
  const search = new URL(request.url).searchParams, selected = search.get("request");
  const view = selected ? (search.get("view") || "detail") : "list";
  if (!["list", "detail", "review"].includes(view)) throw new Response("対象が見つかりません。", { status: 404, headers: auth.headers });
  const page = view === "list" ? await managementReadPage(request, auth, `/api/admin/requests?${managementQuery(request, ["kind"])}`, requestsPageSchema) : null;
  const detail = selected ? await managementRequestDetail(request, auth, "/api/admin/requests", selected) : null;
  return data({ view, page, detail, csrf: auth.session.csrf_token }, { headers: auth.headers });
}
export async function action({ request }: Route.ActionArgs) {
  const auth = await managementSession(request, true),
    form = await request.formData();
  const parsed = z
    .object({
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().trim().min(1).max(2000),
    })
    .safeParse({
      decision: formString(form, "decision"),
      reason: formString(form, "reason"),
    });
  if (formString(form, "intent") !== "decide" || !parsed.success)
    return data<ManagementResult>(
      { code: "validation", error: "承認・拒否と、審査理由を入力してください。" },
      { status: 400, headers: auth.headers },
    );
  return managementWrite(
    request,
    auth,
    `/api/admin/requests/${validID(formString(form, "request_id"))}/decision`,
    formString(form, "_csrf"),
    parsed.data,
  );
}

import { RequestListPage, RequestDetailPage, RequestReviewPage } from "../features/management/request-pages";
export default function AdminRequests({ loaderData, actionData }: Route.ComponentProps) { const i18n = useI18n();
  const { view, page, detail, csrf } = loaderData;
  return <div className={uiStyles["ui-stack"]}><PageHeader title={i18n.t("management.applicationManagement")} /><ActionNotice result={actionData} />
  {detail && <div className={uiStyles["ui-actions"]}>
  <Link className={uiStyles["ui-text-link"]} to="/admin/requests">{i18n.t("management.backToApplications")}</Link>
  <Link className={uiStyles["ui-text-link"]} to={`?request=${detail.id}&view=detail`}>{i18n.t("management.applicationDetails")}</Link>
  {detail.status === "pending" && <Link className={uiStyles["ui-link-button"]} to={`?request=${detail.id}&view=review`}>{i18n.t("management.reviewApplicationAction")}</Link>}
  </div>}
  {view === "list" && page && <RequestListPage page={page} />}
  {view === "detail" && detail && <RequestDetailPage request={detail} />}
  {view === "review" && detail && <RequestReviewPage request={detail} csrf={csrf} />}
  </div>;
}
