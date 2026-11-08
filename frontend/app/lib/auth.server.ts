import { redirect, type HeadersFunction } from "react-router";
import { z } from "zod";

// PostgreSQL and the existing API also accept UUIDs without a version/variant restriction.
const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const sessionSchema = z.object({
  user: z.object({ id: uuidSchema, email: z.string(), email_verified: z.boolean(), account_type: z.enum(["general", "business"]).optional(), display_name: z.string().optional() }),
  memberships: z.array(z.object({ tenant_id: uuidSchema, tenant_name: z.string(), staff_id: uuidSchema, display_name: z.string() })),
  selected_staff_id: uuidSchema.nullable(),
  system_admin: z.boolean(),
  csrf_token: z.string(),
});
export type SessionView = z.infer<typeof sessionSchema>;
export type AuthContext = { session: SessionView; cookie: string; headers: Headers };

export const sessionHeaders: HeadersFunction = ({ loaderHeaders, actionHeaders, errorHeaders }) => {
  const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  for (const source of [loaderHeaders, actionHeaders, errorHeaders]) {
    if (source) for (const cookie of source.getSetCookie()) headers.append("Set-Cookie", cookie);
  }
  return headers;
};

function baseURL() {
  return process.env.API_INTERNAL_URL || "http://127.0.0.1:8081";
}
function appendCookies(response: Response, headers: Headers) {
  for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
}
export async function apiFetch(request: Request, path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  headers.set("Accept", "application/json");
  return fetch(new URL(path, baseURL()), { ...init, headers, cache: "no-store", redirect: "manual", signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]) });
}
export const firebaseConfigSchema = z.object({
  enabled: z.boolean(), apiKey: z.string(), authDomain: z.string(), projectId: z.string(), appId: z.string(), emulatorUrl: z.string(),
});
export type FirebaseConfig = z.infer<typeof firebaseConfigSchema>;
export async function firebaseConfig(request: Request): Promise<FirebaseConfig | null> {
  try {
    const response = await apiFetch(request, "/api/auth/config", "");
    if (!response.ok) return null;
    return z.object({ data: firebaseConfigSchema }).parse(await response.json()).data;
  } catch { return null; }
}
export async function requireSession(request: Request): Promise<AuthContext> {
  const cookie = request.headers.get("Cookie") || "";
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!cookie) throw redirect("/login", { headers });
  const response = await apiFetch(request, "/api/auth/me", cookie);
  if (response.status === 401) throw redirect("/login", { headers });
  if (!response.ok) throw new Response("ログイン状態を確認できません。", { status: 503, headers });
  const result = z.object({ data: sessionSchema }).safeParse(await response.json());
  if (!result.success) throw new Response("ログイン状態を確認できません。", { status: 503, headers });
  return { session: result.data.data, cookie, headers };
}
export async function authenticatedPost(request: Request, auth: AuthContext, path: string, csrf: string, body?: object) {
  const response = await apiFetch(request, path, auth.cookie, {
    method: "POST",
    headers: { Origin: request.headers.get("Origin") || "", Referer: request.headers.get("Referer") || "", "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  appendCookies(response, auth.headers);
  return response;
}
