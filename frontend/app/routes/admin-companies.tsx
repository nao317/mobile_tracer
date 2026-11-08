import { data, Form, Link } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-companies";
import { managementRevalidate } from "../features/management/model";
import {
  Badge,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
  TextField,
} from "../components/ui/primitives";
import { sessionHeaders } from "../lib/auth.server";
import {
  managementSession,
  managementRead,
  managementWrite,
  managementQuery,
  validID,
  formString,
  companyForm,
} from "../features/management/api.server";
import {
  companiesPageSchema,
  companySchema,
  companyStatusLabels,
  memberSchema,
  usersPageSchema,
  type ManagementResult,
} from "../features/management/model";
import {
  ActionNotice,
  CSRF,
  CompanyFields,
  ManagementFilters,
  ManagementPagination,
  ManagementSubmit,
  StatusFilter,
} from "../features/management/shared";
import { roleLabels } from "../features/workspace/model";

export const headers = sessionHeaders;
export const shouldRevalidate = managementRevalidate;
export function meta() {
  return [{ title: "企業・プロファイル管理 | Mobile Tracer" }];
}
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await managementSession(request, true),
    search = new URL(request.url).searchParams,
    selected = search.get("company");
  const [page, detail, candidates] = await Promise.all([
    managementRead(
      request,
      auth,
      `/api/admin/companies?${managementQuery(request)}`,
      companiesPageSchema,
    ),
    selected
      ? managementRead(
          request,
          auth,
          `/api/admin/companies/${validID(selected)}`,
          z.object({
            data: z.object({
              company: companySchema,
              members: z.array(memberSchema),
            }),
          }),
        )
      : Promise.resolve(null),
    managementRead(
      request,
      auth,
      `/api/admin/users?${new URLSearchParams({ account_type: "business", status: "active", page_size: "100", ...(search.get("candidate_q") ? { q: search.get("candidate_q")! } : {}) })}`,
      usersPageSchema,
    ),
  ]);
  return data(
    {
      page,
      detail: detail?.data ?? null,
      candidates: candidates.data,
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
    { error: "操作を確認してください。" },
    { status: 400, headers: auth.headers },
  );
}
export default function AdminCompanies({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { page, detail, candidates, csrf } = loaderData;
  const options = candidates.map((user) => (
    <option key={user.id} value={user.id}>
      {user.display_name || user.email} / {user.email}
    </option>
  ));
  return (
    <>
      <PageHeader
        title="企業・プロファイル管理"
        description="企業情報と、業者ユーザーの所属を管理します。企業を停止すると業務へのアクセスも停止します。"
      />
      <ActionNotice result={actionData} />
      <Panel>
        <ManagementFilters>
          <StatusFilter label="企業の状態" values={companyStatusLabels} />
        </ManagementFilters>
      </Panel>
      <Panel title="企業一覧">
        {page.data.length ? (
          <table className="ui-table ui-table--responsive">
            <thead>
              <tr>
                <th>企業</th>
                <th>正式名称</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((company) => (
                <tr key={company.id}>
                  <td data-label="企業">
                    <Link to={`?company=${company.id}`}>{company.name}</Link>
                  </td>
                  <td data-label="正式名称">
                    {company.profile.legal_name || "未登録"}
                  </td>
                  <td data-label="状態">
                    <Badge
                      tone={company.status === "active" ? "success" : "warning"}
                    >
                      {companyStatusLabels[company.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="企業が見つかりません" />
        )}
        <ManagementPagination pagination={page.pagination} />
      </Panel>
      <Panel title="所属させる業者ユーザーを探す">
        <Form method="get" className="workspace-filter">
          {detail && (
            <input type="hidden" name="company" value={detail.company.id} />
          )}
          <Field id="candidate-q" label="業者の名前・メールアドレス">
            <Input id="candidate-q" name="candidate_q" maxLength={200} />
          </Field>
          <ManagementSubmit>候補を検索</ManagementSubmit>
        </Form>
        <p className="ui-hint">
          企業作成・所属追加の選択肢には、条件に合う有効な業者ユーザーを最大100件表示します。
        </p>
      </Panel>
      {detail && (
        <>
          <Panel title="企業プロファイルの編集">
            <Form
              key={`${detail.company.id}:${detail.company.version}`}
              method="post"
              className="ui-form"
            >
              <CSRF token={csrf} intent="updateCompany" />
              <input
                type="hidden"
                name="company_id"
                value={detail.company.id}
              />
              <input
                type="hidden"
                name="version"
                value={detail.company.version}
              />
              <CompanyFields company={detail.company} />
              <Field id="company-status" label="企業の状態">
                <Select
                  id="company-status"
                  name="status"
                  defaultValue={detail.company.status}
                >
                  {Object.entries(companyStatusLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="workspace-check">
                <input type="checkbox" required />
                対象企業・プロファイル・利用状態の変更を確認しました
              </label>
              <ManagementSubmit>企業情報を保存</ManagementSubmit>
            </Form>
          </Panel>
          <Panel title="所属する業者ユーザー">
            {detail.members.length ? (
              <table className="ui-table ui-table--responsive">
                <thead>
                  <tr>
                    <th>業者</th>
                    <th>企業内の役割</th>
                    <th>所属状態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.members.map((member) => (
                    <tr key={`${member.id}:${member.role}`}>
                      <td data-label="業者">
                        <Link to={`/admin/users?user=${member.user_id}`}>
                          {member.display_name || member.email}
                        </Link>
                        <span className="workspace-table-subtitle">
                          {member.email}
                        </span>
                      </td>
                      <td data-label="役割">
                        {roleLabels[member.role as keyof typeof roleLabels] ??
                          member.role}
                      </td>
                      <td data-label="所属状態">
                        {member.revoked_at ? "解除済み" : "所属中"}
                      </td>
                      <td data-label="操作">
                        {!member.revoked_at && (
                          <details>
                            <summary>所属を解除</summary>
                            <Form method="post" className="ui-form">
                              <CSRF token={csrf} intent="revokeMember" />
                              <input
                                type="hidden"
                                name="company_id"
                                value={detail.company.id}
                              />
                              <input
                                type="hidden"
                                name="link_id"
                                value={member.id}
                              />
                              <TextField
                                id={`revoke-${member.id}-${member.role}`}
                                name="reason"
                                label="所属解除の理由"
                                maxLength={2000}
                                required
                              />
                              <ManagementSubmit variant="danger">
                                この所属を解除
                              </ManagementSubmit>
                            </Form>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState title="所属する業者ユーザーはいません" />
            )}
            <details className="workspace-details">
              <summary>業者ユーザーを所属させる</summary>
              <Form method="post" className="ui-form">
                <CSRF token={csrf} intent="addMember" />
                <input
                  type="hidden"
                  name="company_id"
                  value={detail.company.id}
                />
                <Field id="member-user" label="追加する業者ユーザー">
                  <Select id="member-user" name="user_id" required>
                    <option value="">業者ユーザーを選択</option>
                    {options}
                  </Select>
                </Field>
                <Field id="member-role" label="企業内の役割">
                  <Select id="member-role" name="role">
                    <option value="staff">担当者</option>
                    <option value="tenant_admin">企業管理者</option>
                    <option value="auditor">監査担当</option>
                  </Select>
                </Field>
                <ManagementSubmit>所属を追加</ManagementSubmit>
              </Form>
            </details>
          </Panel>
        </>
      )}
      <Panel title="企業の直接作成">
        <details>
          <summary>システム管理者として企業・プロファイルを作成する</summary>
          <Form method="post" className="ui-form mt-4">
            <CSRF token={csrf} intent="createCompany" />
            <CompanyFields />
            <Field
              id="company-owner"
              label="最初の企業管理者となる業者ユーザー"
            >
              <Select id="company-owner" name="owner_user_id" required>
                <option value="">業者ユーザーを選択</option>
                {options}
              </Select>
            </Field>
            <ManagementSubmit>企業を作成</ManagementSubmit>
          </Form>
        </details>
      </Panel>
    </>
  );
}
