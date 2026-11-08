import { createTranslator } from "../i18n";
import { routeLocale } from "../i18n/route-locale";
import { useI18n } from "../components/ui/display-settings";
import uiStyles from "../components/ui/ui.module.css";
import { ManagementLink as Link } from "../features/management/navigation";
import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/my-requests";
import { managementRevalidate } from "../features/management/model";
import { Alert, PageHeader } from "../components/ui/primitives";
import { sessionHeaders } from "../lib/auth.server";
import {
  managementRequestDetail,
  pendingOwnRequests,
  managementSession,
  managementRead,
  managementReadPage,
  managementWrite,
  formString,
  companyForm,
  validID,
} from "../features/management/api.server";
import { companySchema, requestsPageSchema, type ManagementResult } from "../features/management/model";
import { ActionNotice } from "../features/management/shared";

export const headers = sessionHeaders;
export const shouldRevalidate = managementRevalidate;
export function meta({ matches }: Route.MetaArgs) {
  return [{ title: `${createTranslator(routeLocale(matches))("navigation.requests")} | Mobile Tracer` }];
}
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await managementSession(request),
    search = new URL(request.url).searchParams;
  const view = search.get("view") || (search.get("company") ? "company" : "history");
  if (!["history", "detail", "upgrade", "new-company", "companies", "company", "profile"].includes(view))
    throw new Response("対象が見つかりません。", { status: 404, headers: auth.headers });
  const [requests, companies, pending, detail] = await Promise.all([
    view === "history" ? managementReadPage(request, auth, `/api/me/requests?${new URLSearchParams({ page: search.get("page") || "1" })}`, requestsPageSchema) : null,
    ["companies", "company", "profile"].includes(view) ? managementRead(request, auth, "/api/me/companies", z.object({ data: z.array(companySchema) })) : null,
    ["upgrade", "new-company", "profile"].includes(view) ? pendingOwnRequests(request, auth) : [],
    view === "detail" ? managementRequestDetail(request, auth, "/api/me/requests", search.get("request") || "") : null,
  ]);
  const company = companies?.data.find(item => item.id === search.get("company"));
  if (["company", "profile"].includes(view) && !company)
    throw new Response("所属企業が見つかりません。", { status: 404, headers: auth.headers });
  return data({ view, requests, companies: companies?.data ?? [], company, pending, detail,
    csrf: auth.session.csrf_token, user: auth.session.user,
    requestKeys: { upgrade: crypto.randomUUID(), company: crypto.randomUUID(), profile: crypto.randomUUID() },
  }, { headers: auth.headers });
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await managementSession(request),
    form = await request.formData(),
    intent = formString(form, "intent");
  const requestKey = validID(formString(form, "request_key"));
  let body: object;
  if (intent === "upgradeRequest")
    body = {
      kind: "business_upgrade",
      request_key: requestKey,
      payload: {
        display_name: formString(form, "display_name"),
        reason: formString(form, "reason"),
      },
    };
  else if (intent === "companyRequest")
    body = {
      kind: "company_create",
      request_key: requestKey,
      payload: companyForm(form),
    };
  else if (intent === "profileRequest")
    body = {
      kind: "company_profile_update",
      request_key: requestKey,
      company_id: validID(formString(form, "company_id")),
      payload: {
        ...companyForm(form),
        version: Number(formString(form, "version")),
      },
    };
  else
    return data<ManagementResult>(
      { code: "validation", error: "申請種別を確認してください。" },
      { status: 400, headers: auth.headers },
    );
  return managementWrite(
    request,
    auth,
    "/api/me/requests",
    formString(form, "_csrf"),
    body,
  );
}

import { MyHistoryPage, MyRequestDetailPage, UpgradeRequestPage, CompanyCreateRequestPage, MyCompaniesPage, MyCompanyPage, ProfileRequestPage } from "../features/management/my-request-pages";
export default function MyRequests({ loaderData, actionData }: Route.ComponentProps) { const i18n = useI18n();
  const { view, requests, companies, company, pending, detail, csrf, user, requestKeys } = loaderData;
  const type = user.account_type ?? "general";
  return <div className={uiStyles["ui-stack"]}><PageHeader title={i18n.t("management.myApplicationsCompanies")} description={i18n.t("management.applicationDescription", { type: i18n.enumLabel("accountType", type) })} />
    <ActionNotice result={actionData} />
    <div className={uiStyles["ui-actions"]}>
      <Link className={uiStyles["ui-text-link"]} to="?view=history">{i18n.t("management.myHistory")}</Link>
      {type === "general" ? <Link className={uiStyles["ui-link-button"]} to="?view=upgrade">{i18n.t("management.upgradeRequest")}</Link> : <>
      <Link className={uiStyles["ui-text-link"]} to="?view=companies">{i18n.t("management.memberCompanies")}</Link>
      <Link className={uiStyles["ui-link-button"]} to="?view=new-company">{i18n.t("management.companyCreationRequest")}</Link>
      </>}
    </div>
    {view === "history" && requests && <MyHistoryPage requests={requests} />}
    {view === "detail" && detail && <MyRequestDetailPage request={detail} />}
    {view === "upgrade" && (type === "general" ? <UpgradeRequestPage pending={pending} csrf={csrf} requestKey={requestKeys.upgrade} user={user} /> : <Alert>{i18n.t("management.upgradeApproved")}</Alert>)}
    {view === "new-company" && (type === "business" ? <CompanyCreateRequestPage pending={pending} csrf={csrf} requestKey={requestKeys.company} /> : <Alert>{i18n.t("management.upgradeRequired")}</Alert>)}
    {view === "companies" && <MyCompaniesPage companies={companies} />}
    {view === "company" && company && <MyCompanyPage company={company} />}
    {view === "profile" && company && <ProfileRequestPage company={company} pending={pending} csrf={csrf} requestKey={requestKeys.profile} />}
  </div>;
}
