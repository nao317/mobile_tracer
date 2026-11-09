import { data, redirect } from "react-router";
import { z } from "zod";
import { apiFetch, requireSession } from "../../lib/auth.server";
import {
  managementRead,
  managementWrite,
  validID,
} from "../management/api.server";
import { ownersSchema, transactionSchema } from "./model";
export async function loadTransaction(request: Request, id: string) {
  const auth = await requireSession(request);
  validID(id);
  const [result, owners] = await Promise.all([
    managementRead(
      request,
      auth,
      `/api/transactions/${id}`,
      z.object({ data: transactionSchema }),
    ),
    managementRead(
      request,
      auth,
      `/api/transactions/${id}/ownerships`,
      ownersSchema,
    ),
  ]);
  return data(
    {
      item: result.data,
      owners: owners.data,
      csrf: auth.session.csrf_token,
      user: auth.session.user,
      session: auth.session,
      requestKey: crypto.randomUUID(),
      now: Date.now(),
    },
    { headers: auth.headers },
  );
}
function iso(value: FormDataEntryValue | null) {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.valueOf()))
    throw new Response("日時を確認してください。", { status: 400 });
  return date.toISOString();
}
export async function transactionAction(request: Request, id: string) {
  const auth = await requireSession(request);
  validID(id);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const csrf = String(form.get("_csrf") ?? "");
  const path = `/api/transactions/${id}`;
  if (intent === "photo") {
    const response = await apiFetch(request, path + "/media", auth.cookie, {
      method: "POST",
      headers: {
        Origin: request.headers.get("Origin") ?? "",
        Referer: request.headers.get("Referer") ?? "",
        "X-CSRF-Token": csrf,
      },
      body: form,
    });
    if (!response.ok) {
      const result = z
        .object({
          error: z.object({
            message: z.string(),
            fields: z.record(z.string(), z.array(z.string())).optional(),
          }),
        })
        .safeParse(await response.json().catch(() => null));
      return data(
        {
          error: result.success
            ? Object.values(result.data.error.fields ?? {}).flat().join(" ") ||
              result.data.error.message
            : "画像を保存できませんでした。最新の状態を確認してください。",
        },
        { status: response.status, headers: auth.headers },
      );
    }
    return data({ message: "画像を保存しました。" }, { headers: auth.headers });
  }
  if (intent === "present") {
    const count = Number(form.get("recipient_count"));
    if (!Number.isInteger(count) || count < 1 || count > 20)
      throw new Response("確認先を確認してください。", { status: 400 });
    return managementWrite(request, auth, path + "/present", csrf, {
      lock_version: Number(form.get("lock_version")),
      request_key: form.get("request_key"),
      recipients: Array.from({ length: count }, (_, i) => ({
        email: form.get(`email-${i}`),
        qualification: form.get(`qualification-${i}`),
        kind: form.get(`kind-${i}`),
        statement: form.get(`statement-${i}`),
        deadline: iso(form.get(`deadline-${i}`)),
      })),
    });
  }
  if (intent === "respond") {
    if (form.get("confirmed") !== "1")
      throw new Response("内容の確認が必要です。", { status: 400 });
    return managementWrite(request, auth, path + "/respond", csrf, {
      request_id: form.get("request_id"),
      decision: form.get("decision"),
    });
  }
  if (intent === "share")
    return managementWrite(request, auth, path + "/share", csrf, {
      email: form.get("email"),
      expires_at: iso(form.get("expires_at")),
    });
  if (intent === "ownership")
    return managementWrite(request, auth, path + "/ownerships", csrf, {
      user_id: form.get("user_id"),
      effective_at: iso(form.get("effective_at")),
    });
  if (intent === "verify") {
    const response = await apiFetch(request, path + "/verify", auth.cookie, {
      method: "POST",
      headers: {
        Origin: request.headers.get("Origin") ?? "",
        Referer: request.headers.get("Referer") ?? "",
        "X-CSRF-Token": csrf,
      },
    });
    if (!response.ok)
      return data(
        { error: "検証できませんでした。" },
        { status: response.status, headers: auth.headers },
      );
    const result = z
      .object({ data: z.object({ result: z.string() }) })
      .parse(await response.json());
    return data({ result: result.data.result }, { headers: auth.headers });
  }
  if (intent === "retry")
    return managementWrite(request, auth, path + "/retry", csrf, {});
  if (intent === "correct") {
    const response = await apiFetch(request, path + "/correct", auth.cookie, {
      method: "POST",
      headers: {
        Origin: request.headers.get("Origin") ?? "",
        Referer: request.headers.get("Referer") ?? "",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: form.get("reason") }),
    });
    if (!response.ok)
      return data(
        {
          error:
            "訂正版を作成できませんでした。下書きの有無と権限を確認してください。",
        },
        { status: response.status, headers: auth.headers },
      );
    const { data: draft } = z
      .object({
        data: z.object({
          id: z.string(),
          case_id: z.string(),
          record_id: z.string(),
        }),
      })
      .parse(await response.json());
    return redirect(
      `/app/cases/${draft.case_id}/records/${draft.record_id}/edit?version=${draft.id}`,
      { headers: auth.headers },
    );
  }
  throw new Response("操作を確認してください。", { status: 400 });
}
