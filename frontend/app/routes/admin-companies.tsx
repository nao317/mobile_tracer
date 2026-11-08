import { createTranslator } from "../i18n";
import { routeLocale } from "../i18n/route-locale";
import { useI18n } from "../components/ui/display-settings";
import uiStyles from "../components/ui/ui.module.css";
import { ManagementLink as Link } from "../features/management/navigation";
import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-companies";
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
  companyForm,
} from "../features/management/api.server";
import {
  companiesPageSchema,
  companySchema,
  memberSchema,
  usersPageSchema,
  type ManagementResult,
} from "../features/management/model";
import { ActionNotice } from "../features/management/shared";


export const headers = sessionHeaders;
export const shouldRevalidate = managementRevalidate;
export function meta({ matches }: Route.MetaArgs) {
  return [{ title: `${createTranslator(routeLocale(matches))("navigation.companies")} | Mobile Tracer` }];
}
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await managementSession(request, true),
    search = new URL(request.url).searchParams,
    selected = search.get("company");
  const view = selected ? (search.get("view") || "detail") : (search.get("view") || "list");
  if (!["list", "detail", "edit", "members", "new"].includes(view) || (["detail", "edit", "members"].includes(view) && !selected))
    throw new Response("対象が見つかりません。", { status: 404, headers: auth.headers });
  const [page, detail, candidates] = await Promise.all([
    view === "list" ? managementReadPage(request, auth, `/api/admin/companies?${managementQuery(request)}`, companiesPageSchema) : null,
    selected && ["detail", "edit", "members"].includes(view) ? managementRead(request, auth, `/api/admin/companies/${validID(selected)}`, z.object({ data: z.object({ company: companySchema, members: z.array(memberSchema) }) })) : null,
    ["members", "new"].includes(view) ? managementReadPage(request, auth, `/api/admin/users?${new URLSearchParams({ account_type: "business", status: "active", page_size: "20", page: search.get("candidatePage") || "1", ...(search.get("candidate_q") ? { q: search.get("candidate_q")! } : {}) })}`, usersPageSchema) : null,
  ]);
  return data(
    {
      view,
      page,
      detail: detail?.data ?? null,
      candidates: candidates?.data ?? [],
      candidatePagination: candidates?.pagination ?? null,
      csrf: auth.session.csrf_token,
    },
    { headers: auth.headers },
  );
}
export async function action({ request }: Route.ActionArgs) {
  const auth = await managementSession(request, true),
    form = await request.formData(),
    intent = formString(form, "intent"),
    csrf = formString(form, "_csrf");
  if (intent === "createCompany")
    return managementWrite(request, auth, "/api/admin/companies", csrf, {
      ...companyForm(form),
      owner_user_id: validID(formString(form, "owner_user_id")),
    });
  const id = validID(formString(form, "company_id"));
  if (intent === "updateCompany")
    return managementWrite(
      request,
      auth,
      `/api/admin/companies/${id}`,
      csrf,
      {
        ...companyForm(form),
        status: formString(form, "status"),
        version: Number(formString(form, "version")),
      },
      "PATCH",
    );
  if (intent === "addMember")
    return managementWrite(
      request,
      auth,
      `/api/admin/companies/${id}/members`,
      csrf,
      {
        user_id: validID(formString(form, "user_id")),
        role: formString(form, "role"),
      },
    );
  if (intent === "revokeMember")
    return managementWrite(
      request,
      auth,
      `/api/admin/companies/${id}/members/${validID(formString(form, "link_id"))}/revoke`,
      csrf,
      { reason: formString(form, "reason") },
    );
  return data<ManagementResult>(
    { code: "validation", error: "操作を確認してください。" },
    { status: 400, headers: auth.headers },
  );
}

import { CompanyListPage, CompanyDetailPage, CompanyEditPage, CompanyMembersPage, CompanyNewPage } from "../features/management/company-pages";
export default function AdminCompanies({ loaderData, actionData }: Route.ComponentProps) { const i18n = useI18n();
  const { view, page, detail, candidates, candidatePagination, csrf } = loaderData;
  return <div className={uiStyles["ui-stack"]}>
    <PageHeader title={i18n.t("management.companyManagement")} actions={<Link className={uiStyles["ui-link-button"]} to="?view=new">{i18n.t("management.createCompany")}</Link>} />
    <ActionNotice result={actionData} />
    {view !== "list" && <Link className={uiStyles["ui-text-link"]} to="/admin/companies">{i18n.t("management.backToCompanies")}</Link>}
    {detail && <div className={uiStyles["ui-actions"]}>
      <Link className={uiStyles["ui-text-link"]} to={`?company=${detail.company.id}&view=detail`}>{i18n.t("management.companyDetails")}</Link>
      <Link className={uiStyles["ui-text-link"]} to={`?company=${detail.company.id}&view=edit`}>{i18n.t("management.editCompanyProfile")}</Link>
      <Link className={uiStyles["ui-text-link"]} to={`?company=${detail.company.id}&view=members`}>{i18n.t("management.businessMembers")}</Link>
    </div>}
    {view === "list" && page && <CompanyListPage page={page} />}
    {view === "detail" && detail && <CompanyDetailPage company={detail.company} />}
    {view === "edit" && detail && <CompanyEditPage detail={detail} csrf={csrf} />}
    {view === "members" && detail && <CompanyMembersPage detail={detail} candidates={candidates} candidatePagination={candidatePagination!} csrf={csrf} />}
    {view === "new" && <CompanyNewPage candidates={candidates} candidatePagination={candidatePagination!} csrf={csrf} />}
  </div>;
}
