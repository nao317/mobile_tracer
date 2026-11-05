import { data } from "react-router";
import type { Route } from "./+types/admin";
import { apiFetch, requireSession, sessionHeaders } from "../lib/auth.server";

export const headers = sessionHeaders;

export function meta() { return [{ title: "システム管理者 | MobilTracer" }]; }
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireSession(request);
  const response = await apiFetch(request, "/api/admin/context", auth.cookie);
  if (response.status === 403) throw new Response("システム管理者の権限が必要です。", { status: 403, headers: auth.headers });
  if (!response.ok) throw new Response("管理者の権限を確認できません。", { status: 503, headers: auth.headers });
  return data({ email: auth.session.user.email }, { headers: auth.headers });
}
export default function Admin({ loaderData }: Route.ComponentProps) {
  return <main className="mx-auto max-w-2xl space-y-6 px-6 py-12"><p className="text-sm text-gray-500">MobilTracer</p><h1 className="text-3xl font-semibold">システム管理者</h1><p>{loaderData.email} でログインしています。</p><a href="/account" className="underline">アカウントへ戻る</a></main>;
}
