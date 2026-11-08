import { data, Form, Link } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-users";
import { managementRevalidate } from "../features/management/model";
import {
  Alert,
  Badge,
  EmptyState,
  Field,
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
} from "../features/management/api.server";
import {
  accountLabels,
  managedUserSchema,
  companySchema,
  usersPageSchema,
  type ManagementResult,
} from "../features/management/model";
import {
  ActionNotice,
  CSRF,
  CompanyDetails,
  ManagementFilters,
  ManagementPagination,
  ManagementSubmit,
  StatusFilter,
} from "../features/management/shared";

export const headers = sessionHeaders;
export const shouldRevalidate = managementRevalidate;
export function meta() {
  return [{ title: "ユーザー管理 | Mobile Tracer" }];
}
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await managementSession(request, true),
    selected = new URL(request.url).searchParams.get("user");
  const [page, detail] = await Promise.all([
    managementRead(
      request,
      auth,
      `/api/admin/users?${managementQuery(request, ["account_type"])}`,
      usersPageSchema,
    ),
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
      { error: "操作を確認してください。" },
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
      { error: "入力内容を確認してください。" },
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
export default function AdminUsers({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { page, detail, csrf, self } = loaderData;
  return (
    <>
      <PageHeader
        title="ユーザー管理"
        description="アプリに登録されたユーザーの区分・表示名・利用状態と、所属する企業を確認します。"
      />
      <ActionNotice result={actionData} />
      <Panel>
        <ManagementFilters>
          <StatusFilter
            name="account_type"
            label="ユーザー区分"
            values={accountLabels}
          />
          <StatusFilter
            label="利用状態"
            values={{ active: "有効", suspended: "停止" }}
          />
        </ManagementFilters>
      </Panel>
      <Panel title="ユーザー一覧">
        {page.data.length ? (
          <table className="ui-table ui-table--responsive">
            <thead>
              <tr>
                <th>ユーザー</th>
                <th>区分</th>
                <th>状態</th>
                <th>メール確認</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((user) => (
                <tr key={user.id}>
                  <td data-label="ユーザー">
                    <Link to={`?user=${user.id}`}>
                      {user.display_name || user.email || "表示名未設定"}
                    </Link>
                    <span className="workspace-table-subtitle">
                      {user.email}
                    </span>
                  </td>
                  <td data-label="区分">{accountLabels[user.account_type]}</td>
                  <td data-label="状態">
                    <Badge
                      tone={user.status === "active" ? "success" : "warning"}
                    >
                      {user.status === "active" ? "有効" : "停止"}
                    </Badge>
                  </td>
                  <td data-label="メール確認">
                    {user.email_verified ? "確認済み" : "未確認"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="ユーザーが見つかりません" />
        )}
        <ManagementPagination pagination={page.pagination} />
      </Panel>
      {detail && (
        <>
          <Panel title={`${detail.user.email} の編集`}>
            <Form
              method="post"
              className="ui-form"
              key={`${detail.user.id}:${detail.user.version}`}
            >
              <CSRF token={csrf} intent="updateUser" />
              <input type="hidden" name="user_id" value={detail.user.id} />
              <input type="hidden" name="version" value={detail.user.version} />
              <TextField
                id="display-name"
                name="display_name"
                label="表示名"
                defaultValue={detail.user.display_name}
                maxLength={200}
              />
              <Field id="user-account-type" label="ユーザー区分">
                <Select
                  id="user-account-type"
                  name="account_type"
                  defaultValue={detail.user.account_type}
                >
                  {Object.entries(accountLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="user-status" label="利用状態">
                <Select
                  id="user-status"
                  name="status"
                  defaultValue={detail.user.status}
                >
                  <option value="active">有効</option>
                  <option value="suspended" disabled={detail.user.id === self}>
                    停止
                  </option>
                </Select>
              </Field>
              <Alert tone="warning">
                一般ユーザーへ戻すと企業の所属を解除します。利用停止にすると現在のログインも失効します。
              </Alert>
              <label className="workspace-check">
                <input type="checkbox" required />
                対象ユーザーと変更内容を確認しました
              </label>
              <ManagementSubmit>ユーザー情報を保存</ManagementSubmit>
            </Form>
          </Panel>
          <Panel title="所属する企業">
            {detail.companies.length ? (
              <div className="ui-stack">
                {detail.companies.map((company) => (
                  <div key={company.id}>
                    <CompanyDetails company={company} />
                    <Link
                      className="ui-text-link"
                      to={`/admin/companies?company=${company.id}`}
                    >
                      この企業の所属・プロファイルを管理
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="所属する企業はありません" />
            )}
          </Panel>
        </>
      )}
    </>
  );
}
