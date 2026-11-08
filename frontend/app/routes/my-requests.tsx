import { data, Form, Link } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/my-requests";
import { managementRevalidate } from "../features/management/model";
import {
  Alert,
  EmptyState,
  Field,
  PageHeader,
  Panel,
  TextField,
  Textarea,
} from "../components/ui/primitives";
import { sessionHeaders } from "../lib/auth.server";
import {
  managementSession,
  managementRead,
  managementWrite,
  formString,
  companyForm,
  validID,
} from "../features/management/api.server";
import {
  accountLabels,
  companySchema,
  requestsPageSchema,
  requestLabels,
  type ManagementResult,
} from "../features/management/model";
import {
  ActionNotice,
  CSRF,
  CompanyDetails,
  CompanyFields,
  ManagementPagination,
  ManagementSubmit,
  RequestDetails,
} from "../features/management/shared";

export const headers = sessionHeaders;
export const shouldRevalidate = managementRevalidate;
export function meta() {
  return [{ title: "自分の申請・企業 | Mobile Tracer" }];
}
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await managementSession(request),
    search = new URL(request.url).searchParams;
  const [requests, companies] = await Promise.all([
    managementRead(
      request,
      auth,
      `/api/me/requests?${new URLSearchParams({ page: search.get("page") || "1" })}`,
      requestsPageSchema,
    ),
    managementRead(
      request,
      auth,
      "/api/me/companies",
      z.object({ data: z.array(companySchema) }),
    ),
  ]);
  const company = search.get("company")
    ? companies.data.find((item) => item.id === search.get("company"))
    : companies.data[0];
  if (search.get("company") && !company)
    throw new Response("所属企業が見つかりません。", {
      status: 404,
      headers: auth.headers,
    });
  return data(
    {
      requests,
      companies: companies.data,
      company,
      csrf: auth.session.csrf_token,
      user: auth.session.user,
      requestKeys: {
        upgrade: crypto.randomUUID(),
        company: crypto.randomUUID(),
        profile: crypto.randomUUID(),
      },
    },
    { headers: auth.headers },
  );
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
      { error: "申請種別を確認してください。" },
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
export default function MyRequests({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { requests, companies, company, csrf, user, requestKeys } = loaderData;
  const type = user.account_type ?? "general",
    pending = requests.data.filter((item) => item.status === "pending");
  return (
    <div className="workspace">
      <a className="ui-skip" href="#management-main">
        本文へ移動
      </a>
      <main id="management-main" className="management-main ui-stack">
        <PageHeader
          title="自分の申請・企業"
          description={`${accountLabels[type]}として利用しています。申請はシステム管理者の承認後に反映されます。`}
          actions={
            <Link className="ui-text-link" to="/account">
              アカウントへ戻る
            </Link>
          }
        />
        <ActionNotice result={actionData} />
        {type === "general" ? (
          <Panel title="業者ユーザーへの変更申請">
            {pending.some((item) => item.kind === "business_upgrade") ? (
              <Alert>
                業者ユーザーへの変更は承認待ちです。審査結果は下の申請履歴で確認できます。
              </Alert>
            ) : (
              <Form method="post" className="ui-form">
                <CSRF token={csrf} intent="upgradeRequest" />
                <input
                  type="hidden"
                  name="request_key"
                  value={requestKeys.upgrade}
                />
                <TextField
                  id="upgrade-name"
                  name="display_name"
                  label="業者としての表示名"
                  defaultValue={user.display_name ?? ""}
                  maxLength={200}
                  required
                />
                <Field id="upgrade-reason" label="変更を申請する理由">
                  <Textarea
                    id="upgrade-reason"
                    name="reason"
                    maxLength={2000}
                    required
                  />
                </Field>
                <ManagementSubmit>業者ユーザーへの変更を申請</ManagementSubmit>
              </Form>
            )}
          </Panel>
        ) : (
          <>
            <Panel title="企業・プロファイルの作成申請">
              {pending.some((item) => item.kind === "company_create") ? (
                <Alert>企業作成の申請は承認待ちです。</Alert>
              ) : (
                <Form method="post" className="ui-form">
                  <CSRF token={csrf} intent="companyRequest" />
                  <input
                    type="hidden"
                    name="request_key"
                    value={requestKeys.company}
                  />
                  <CompanyFields />
                  <Alert>
                    承認後に企業が作成され、申請者を最初の企業管理者として所属させます。
                  </Alert>
                  <ManagementSubmit>
                    企業・プロファイルの作成を申請
                  </ManagementSubmit>
                </Form>
              )}
            </Panel>
            <Panel title="所属する企業">
              {companies.length ? (
                <div className="ui-stack">
                  {companies.map((item) => (
                    <div key={item.id}>
                      <CompanyDetails company={item} />
                      <Link className="ui-text-link" to={`?company=${item.id}`}>
                        この企業のプロファイル変更を申請
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="所属する企業はありません">
                  企業作成の申請が承認されると、ここに表示されます。
                </EmptyState>
              )}
            </Panel>
            {company && (
              <Panel title={`${company.name} のプロファイル変更申請`}>
                {company.status !== "active" ? (
                  <Alert>現在、この企業の変更申請は受け付けていません。</Alert>
                ) : pending.some(
                    (item) =>
                      item.kind === "company_profile_update" &&
                      item.company_id === company.id,
                  ) ? (
                  <Alert>この企業のプロファイル変更は承認待ちです。</Alert>
                ) : (
                  <Form
                    key={`${company.id}:${company.version}`}
                    method="post"
                    className="ui-form"
                  >
                    <CSRF token={csrf} intent="profileRequest" />
                    <input
                      type="hidden"
                      name="request_key"
                      value={requestKeys.profile}
                    />
                    <input type="hidden" name="company_id" value={company.id} />
                    <input
                      type="hidden"
                      name="version"
                      value={company.version}
                    />
                    <CompanyFields company={company} />
                    <ManagementSubmit>プロファイル変更を申請</ManagementSubmit>
                  </Form>
                )}
              </Panel>
            )}
          </>
        )}
        <Panel title="自分の申請履歴">
          {requests.data.length ? (
            <div className="ui-stack">
              {requests.data.map((request) => (
                <details
                  className="workspace-details"
                  key={request.id}
                  open={request.status === "pending"}
                >
                  <summary>
                    {requestLabels[request.kind]} /{" "}
                    {request.status === "pending"
                      ? "承認待ち"
                      : request.status === "approved"
                        ? "承認済み"
                        : "拒否"}
                  </summary>
                  <RequestDetails request={request} />
                </details>
              ))}
            </div>
          ) : (
            <EmptyState title="申請履歴はありません" />
          )}
          <ManagementPagination pagination={requests.pagination} />
        </Panel>
      </main>
    </div>
  );
}
