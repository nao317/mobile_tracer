import { data, redirect } from "react-router";
import { z } from "zod";
import {
  apiFetch,
  requireSession,
  type AuthContext,
} from "../../lib/auth.server";
import { idSchema } from "../workspace/model";
import { requestsPageSchema, type ManagementRequest, type ManagementResult } from "./model";

export async function managementSession(request: Request, admin = false) {
  const auth = await requireSession(request);
  if (admin && !auth.session.system_admin)
    throw new Response("システム管理者の権限が必要です。", {
      status: 403,
      headers: auth.headers,
    });
  return auth;
}
export async function managementRead<T>(
  request: Request,
  auth: AuthContext,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(request, path, auth.cookie);
  } catch {
    throw new Response("情報を取得できませんでした。接続を確認してください。", {
      status: 503,
      headers: auth.headers,
    });
  }
  if (response.status === 401)
    throw redirect("/login", { headers: auth.headers });
  if (!response.ok)
    throw new Response(
      response.status === 403
        ? "この操作を行う権限がありません。"
        : response.status === 404
          ? "対象が見つかりません。"
          : "情報を取得できませんでした。",
      {
        status: [400, 403, 404].includes(response.status)
          ? response.status
          : 503,
        headers: auth.headers,
      },
    );
  const result = schema.safeParse(await response.json().catch(() => null));
  if (!result.success)
    throw new Response("情報の形式を確認できませんでした。", {
      status: 502,
      headers: auth.headers,
    });
  return result.data;
}
export async function managementWrite(
  request: Request,
  auth: AuthContext,
  path: string,
  csrf: string,
  body: object,
  method = "POST",
) {
  let response: Response;
  try {
    response = await apiFetch(request, path, auth.cookie, {
      method,
      headers: {
        Origin: request.headers.get("Origin") || "",
        Referer: request.headers.get("Referer") || "",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return data<ManagementResult>(
      {
        error:
          "処理結果が未確定です。申請一覧・管理画面で結果を確認してから再操作してください。",
        code: "result_unknown",
        uncertain: true,
      },
      { status: 503, headers: auth.headers },
    );
  }
  for (const cookie of response.headers.getSetCookie())
    auth.headers.append("Set-Cookie", cookie);
  if (response.status === 401)
    throw redirect("/login", { headers: auth.headers });
  if (!response.ok) {
    const error = z
      .object({
        error: z.object({
          message: z.string(),
          code: z.string(),
          fields: z.record(z.string(), z.array(z.string())).optional(),
        }),
      })
      .safeParse(await response.json().catch(() => null));
    return data<ManagementResult>(
      {
        error: error.success
          ? error.data.error.message
          : "処理できませんでした。結果を確認してください。",
        code: error.success ? error.data.error.code : "request_failed",
        fields: error.success ? error.data.error.fields : undefined,
        uncertain: response.status >= 500,
      },
      { status: response.status, headers: auth.headers },
    );
  }
  const receipt = z
    .object({ data: z.unknown().refine((value) => value != null) })
    .safeParse(await response.json().catch(() => null));
  if (!receipt.success)
    return data<ManagementResult>(
      {
        error:
          "処理結果を確認できませんでした。申請一覧・管理画面で結果を確認してください。",
        code: "result_unknown",
        uncertain: true,
      },
      { status: 502, headers: auth.headers },
    );
  return data<ManagementResult>(
    { message: "処理を完了しました。最新の状態を確認してください。" },
    { headers: auth.headers },
  );
}
export function formString(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}
export function validID(value: string) {
  if (!idSchema.safeParse(value).success)
    throw new Response("対象を確認してください。", { status: 400 });
  return value;
}
export function managementQuery(request: Request, keys: string[] = []) {
  const source = new URL(request.url).searchParams,
    query = new URLSearchParams();
  for (const key of ["page", "q", "status", ...keys]) {
    const value = source.get(key);
    if (value) query.set(key, value);
  }
  return query.toString();
}
export function companyForm(form: FormData) {
  return {
    name: formString(form, "name"),
    profile: {
      legal_name: formString(form, "legal_name"),
      description: formString(form, "description"),
      website: formString(form, "website"),
      phone: formString(form, "phone"),
      address: formString(form, "address"),
      contact_email: formString(form, "contact_email"),
      business_types: form
        .getAll("business_types")
        .filter((v): v is string => typeof v === "string"),
    },
  };
}

// The API exposes request collections only. Resolve details independently of
// list filters so a reviewed request remains available after its status changes.
export async function managementRequestDetail(
  request: Request,
  auth: AuthContext,
  path: "/api/admin/requests" | "/api/me/requests",
  id: string,
) {
  validID(id);
  for (let page = 1; ; page++) {
    const result = await managementRead(request, auth, `${path}?page=${page}&page_size=100`, requestsPageSchema);
    const item = result.data.find((item) => item.id === id);
    if (item) return item;
    if (page * result.pagination.page_size >= result.pagination.total || !result.data.length)
      throw new Response("対象が見つかりません。", { status: 404, headers: auth.headers });
  }
}

export async function pendingOwnRequests(request: Request, auth: AuthContext) {
  const pending: ManagementRequest[] = [];
  for (let page = 1; ; page++) {
    const result = await managementRead(request, auth, `/api/me/requests?status=pending&page=${page}&page_size=100`, requestsPageSchema);
    pending.push(...result.data);
    if (page * result.pagination.page_size >= result.pagination.total || !result.data.length) return pending;
  }
}

export async function managementReadPage<T extends { data: unknown[]; pagination: { page: number; page_size: number; total: number } }>(
  request: Request,
  auth: AuthContext,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const url = new URL(path, "https://management.invalid");
  const requestedPage = Number(url.searchParams.get("page") || "1");
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) url.searchParams.set("page", "1");
  const result = await managementRead(request, auth, `${url.pathname}${url.search}`, schema);
  const lastPage = Math.max(1, Math.ceil(result.pagination.total / result.pagination.page_size));
  if (result.pagination.page <= lastPage) return result;
  url.searchParams.set("page", String(lastPage));
  return managementRead(request, auth, `${url.pathname}${url.search}`, schema);
}
