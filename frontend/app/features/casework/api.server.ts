import { data, redirect } from "react-router";
import { z } from "zod";
import { apiFetch, requireSession } from "../../lib/auth.server";
import { managementRead, validID } from "../management/api.server";
import { caseworkSchema } from "./model";
export async function loadCasework(request: Request, id: string) {
  const auth = await requireSession(request);
  const result = await managementRead(
    request,
    auth,
    `/api/casework/${validID(id)}`,
    z.object({ data: caseworkSchema }),
  );
  return data(
    {
      item: result.data,
      session: auth.session,
      now: Date.now(),
      requestKey: crypto.randomUUID(),
    },
    { headers: auth.headers },
  );
}
export function formDate(
  value: FormDataEntryValue | null,
  offset: FormDataEntryValue | null = null,
) {
  const text = String(value ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    text,
  );
  const minutes = Number(offset ?? 0);
  if (!match || !Number.isInteger(minutes) || Math.abs(minutes) > 840)
    throw new Response("日時を確認してください。", { status: 400 });
  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] ?? 0),
    ) +
      minutes * 60000,
  );
  if (!Number.isFinite(date.valueOf()))
    throw new Response("日時を確認してください。", { status: 400 });
  return date.toISOString();
}
export async function writeCasework(
  request: Request,
  path: string,
  form: FormData,
  body: object,
  redirectOnSuccess?: (value: unknown) => string,
) {
  const auth = await requireSession(request);
  let response: Response;
  try {
    response = await apiFetch(request, path, auth.cookie, {
      method: "POST",
      headers: {
        Origin: request.headers.get("Origin") ?? "",
        Referer: request.headers.get("Referer") ?? "",
        "X-CSRF-Token": String(form.get("_csrf") ?? ""),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return data(
      { error: "結果が未確定です。履歴を確認してから再操作してください。" },
      { status: 503, headers: auth.headers },
    );
  }
  if (response.status === 401)
    throw redirect("/login", { headers: auth.headers });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = z
      .object({
        error: z.object({
          message: z.string(),
          fields: z.record(z.string(), z.array(z.string())).optional(),
        }),
      })
      .safeParse(result);
    return data(
      {
        error: parsed.success
          ? [
              parsed.data.error.message,
              ...Object.values(parsed.data.error.fields ?? {}).flat(),
            ].join(" ")
          : "処理できませんでした。",
      },
      { status: response.status, headers: auth.headers },
    );
  }
  const parsed = z.object({ data: z.unknown() }).safeParse(result);
  if (!parsed.success)
    return data(
      { error: "結果を確認できません。履歴を再読み込みしてください。" },
      { status: 502, headers: auth.headers },
    );
  if (redirectOnSuccess)
    return redirect(redirectOnSuccess(parsed.data.data), {
      headers: auth.headers,
    });
  return data(
    { message: "保存しました。", result: parsed.data.data },
    { headers: auth.headers },
  );
}
export async function caseworkAction(request: Request, id: string) {
  validID(id);
  const form = await request.formData(),
    intent = String(form.get("intent"));
  const base = `/api/casework/${id}`;
  if (intent === "start-response") {
    if (form.get("confirmed") !== "1")
      throw new Response("内容の確認が必要です。", { status: 400 });
    return writeCasework(
      request,
      `/api/casework/starts/${validID(String(form.get("start_id")))}/respond`,
      form,
      { decision: form.get("decision") },
    );
  }
  if (intent === "event") {
    const rawAmount = String(form.get("amount_minor") ?? "");
    const amount = rawAmount === "" ? null : Number(rawAmount);
    if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0))
      throw new Response("金額を整数で指定してください。", { status: 400 });
    return writeCasework(
      request,
      base + "/events",
      form,
      {
        kind: form.get("kind"),
        title: form.get("title"),
        description: form.get("description"),
        deadline: formDate(form.get("deadline"), form.get("_timezone_offset")),
        request_key: form.get("request_key"),
        amount_minor: amount,
        target_stage: form.get("target_stage") || null,
        supersedes_id: form.get("supersedes_id") || null,
        parent_event_id: form.get("parent_event_id") || null,
      },
      () => `/casework/${id}/timeline`,
    );
  }
  if (intent === "event-action") {
    if (form.get("confirmed") !== "1")
      throw new Response("内容の確認が必要です。", { status: 400 });
    return writeCasework(
      request,
      base + `/events/${validID(String(form.get("event_id")))}/actions`,
      form,
      {
        action: form.get("decision") || form.get("action"),
        detail: form.get("detail") ?? "",
        request_key: form.get("request_key"),
      },
    );
  }
  if (intent === "verify")
    return writeCasework(
      request,
      base + `/verify/${validID(String(form.get("registration_id")))}`,
      form,
      {},
    );
  throw new Response("操作を確認してください。", { status: 400 });
}
