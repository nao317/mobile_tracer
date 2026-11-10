import { data, redirect } from "react-router";
import { z } from "zod";
import {
  apiFetch,
  requireSession,
  type AuthContext,
} from "../../lib/auth.server";
import {
  caseSchema,
  contextSchema,
  entriesFromForm,
  idSchema,
  paginationSchema,
  recordSchema,
  rulesFor,
  vehicleSchema,
  versionSchema,
  type CommandResult,
  type WorkspaceData,
} from "./model";
import { coreScreens, resolveScreen, type Screen } from "./screens";

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export const previewEnabled = () =>
  process.env.ENABLE_UI_PREVIEW === "1" && process.env.APP_ENV !== "production";

async function read<T>(
  request: Request,
  auth: AuthContext,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(request, path, auth.cookie);
  } catch {
    throw new Response(
      "接続できませんでした。時間をおいて再読み込みしてください。",
      { status: 503, headers: auth.headers },
    );
  }
  if (response.status === 401)
    throw redirect("/login", { headers: auth.headers });
  if (!response.ok)
    throw new Response(
      response.status === 404
        ? "対象が見つかりません。"
        : response.status === 403
          ? "この情報を表示する権限がありません。"
          : "情報を取得できませんでした。再読み込みしてください。",
      {
        status: [403, 404].includes(response.status) ? response.status : 503,
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
async function businessAuth(request: Request) {
  const auth = await requireSession(request);
  if (auth.session.user.account_type === "general")
    throw redirect("/casework", { headers: auth.headers });
  if (!auth.session.selected_staff_id)
    throw redirect("/account", { headers: auth.headers });
  return auth;
}
function pageQuery(request: Request, auth: AuthContext, key = "page") {
  const value = new URL(request.url).searchParams.get(key) ?? "1";
  if (
    !/^\d+$/.test(value) ||
    !z.coerce.number().int().min(1).max(1000000).safeParse(value).success
  )
    throw new Response("検索条件を確認してください。", {
      status: 400,
      headers: auth.headers,
    });
  return new URLSearchParams({ page: String(Number(value)), page_size: "20" });
}
function listQuery(request: Request, auth: AuthContext, cases: boolean) {
  const search = new URL(request.url).searchParams;
  const parsed = z
    .object({
      q: z.string().max(200),
      case_type: z.enum(["", "rental", "dealer", "repair"]),
      status: z.enum(["", "in_progress", "completed", "cancelled"]),
    })
    .safeParse({
      q: search.get("q") ?? "",
      case_type: cases ? search.get("case_type") ?? "" : "",
      status: cases ? search.get("status") ?? "" : "",
    });
  if (!parsed.success)
    throw new Response("検索条件を確認してください。", {
      status: 400,
      headers: auth.headers,
    });
  const query = pageQuery(request, auth);
  if (parsed.data.q) query.set("q", parsed.data.q);
  if (parsed.data.case_type) query.set("case_type", parsed.data.case_type);
  if (parsed.data.status) query.set("status", parsed.data.status);
  return query;
}

/** The API returns an empty page past the end; retrieve the actual last page. */
async function readPage<T>(
  request: Request,
  auth: AuthContext,
  path: string,
  query: URLSearchParams,
  schema: z.ZodType<T>,
) {
  while (true) {
    const result = await read(
      request,
      auth,
      `${path}?${query}`,
      z.object({ data: z.array(schema), pagination: paginationSchema }),
    );
    const lastPage = Math.max(
      1,
      Math.ceil(result.pagination.total / result.pagination.page_size),
    );
    if (Number(query.get("page")) <= lastPage) return result;
    query.set("page", String(lastPage));
  }
}

/** Deduplicate relations and cap concurrent detail requests for displayed rows. */
async function caseVehicles(
  request: Request,
  auth: AuthContext,
  cases: WorkspaceData["cases"],
) {
  const ids = [...new Set(cases.map((item) => item.vehicle_id))];
  const vehicles: WorkspaceData["vehicles"] = [];
  for (let offset = 0; offset < ids.length; offset += 4) {
    const batch = await Promise.all(
      ids.slice(offset, offset + 4).map(
        async (id) =>
          (
            await read(
              request,
              auth,
              `/api/vehicles/${id}`,
              z.object({ data: vehicleSchema }),
            )
          ).data,
      ),
    );
    vehicles.push(...batch);
  }
  return vehicles;
}

export async function loadWorkspace(request: Request, path: string) {
  const auth = await businessAuth(request);
  const screen = resolveScreen(path);
  if (
    !screen ||
    Object.values(screen.params).some((id) => !idSchema.safeParse(id).success)
  )
    throw new Response("対象が見つかりません。", {
      status: 404,
      headers: auth.headers,
    });
  const context = (
    await read(request, auth, "/api/context", z.object({ data: contextSchema }))
  ).data;
  const snapshot: WorkspaceData = {
    context,
    vehicles: [],
    cases: [],
    records: [],
    versions: [],
    workflow: null,
  };
  if (screen.key === "vehicles" || screen.key === "case-new") {
    const query = listQuery(request, auth, false);
    const selected =
      screen.key === "case-new"
        ? new URL(request.url).searchParams.get("vehicle")
        : null;
    if (selected && !idSchema.safeParse(selected).success)
      throw new Response("車両を確認してください。", {
        status: 400,
        headers: auth.headers,
      });
    const vehicles = await readPage(
      request, auth, "/api/vehicles", query, vehicleSchema,
    );
    snapshot.vehicles = vehicles.data;
    snapshot.pagination = snapshot.vehiclesPagination = vehicles.pagination;
    if (selected)
      snapshot.selectedVehicle =
        vehicles.data.find((vehicle) => vehicle.id === selected) ??
        (
          await read(
            request,
            auth,
            `/api/vehicles/${selected}`,
            z.object({ data: vehicleSchema }),
          )
        ).data;
  } else if (screen.key === "cases") {
    const cases = await readPage(
      request, auth, "/api/cases", listQuery(request, auth, true), caseSchema,
    );
    snapshot.cases = cases.data;
    snapshot.pagination = snapshot.casesPagination = cases.pagination;
    snapshot.vehicles = await caseVehicles(request, auth, cases.data);
  } else if (screen.key === "vehicle") {
    const editing = new URL(request.url).searchParams.get("view") === "edit";
    const query = editing ? null : pageQuery(request, auth, "relatedPage");
    query?.set("vehicle_id", screen.params.vehicleId);
    const [vehicle, related] = await Promise.all([
      read(
        request,
        auth,
        `/api/vehicles/${screen.params.vehicleId}`,
        z.object({ data: vehicleSchema }),
      ),
      query ? readPage(request, auth, "/api/cases", query, caseSchema) : null,
    ]);
    snapshot.vehicles = [vehicle.data];
    if (related) {
      snapshot.cases = related.data;
      snapshot.relatedPagination = related.pagination;
    }
  } else if (
    ["case", "case-records", "case-manage", "record-new", "record", "record-edit", "record-history", "photos"].includes(screen.key)
  ) {
    const recordPath = `/api/cases/${screen.params.caseId}/records`;
    const recordsQuery =
      screen.key === "case-records" ? pageQuery(request, auth, "recordsPage") : null;
    const historyQuery =
      screen.key === "record-history" ? pageQuery(request, auth, "historyPage") : null;
    historyQuery?.set("sort", "-version_no");
    const selected =
      screen.params.recordId
        ? new URL(request.url).searchParams.get("version")
        : null;
    if (selected && !idSchema.safeParse(selected).success)
      throw new Response("版を確認してください。", {
        status: 400,
        headers: auth.headers,
      });
    const item = (
      await read(
        request,
        auth,
        `/api/cases/${screen.params.caseId}`,
        z.object({ data: caseSchema }),
      )
    ).data;
    snapshot.cases = [item];
    snapshot.vehicles = await caseVehicles(request, auth, [item]);
    if (context.configuration?.id !== item.configuration_version_id)
      snapshot.notice =
        "この案件が使用する設定版を取得できないため、項目編集と段階変更を停止しています。";
    if (recordsQuery) {
      const records = await readPage(
        request, auth, recordPath, recordsQuery, recordSchema,
      );
      snapshot.records = records.data;
      snapshot.recordsPagination = records.pagination;
    }
    if (screen.params.recordId) {
      const record = (
        await read(
          request,
          auth,
          `${recordPath}/${screen.params.recordId}`,
          z.object({ data: recordSchema }),
        )
      ).data;
      snapshot.records = [record];
      const versionsPath = `${recordPath}/${record.id}/versions`;
      if (historyQuery) {
        const history = await readPage(
          request, auth, versionsPath, historyQuery, versionSchema,
        );
        snapshot.versions = history.data;
        snapshot.historyPagination = history.pagination;
      }
      if (selected) {
        snapshot.selectedVersion =
          snapshot.versions.find((version) => version.id === selected) ??
          (
            await read(
              request,
              auth,
              `${versionsPath}/${selected}`,
              z.object({ data: versionSchema }),
            )
          ).data;
      } else if (snapshot.historyPagination?.page === 1) {
        snapshot.selectedVersion = snapshot.versions[0] ?? null;
      } else {
        const latest = await readPage(
          request,
          auth,
          versionsPath,
          new URLSearchParams({ page: "1", page_size: "1", sort: "-version_no" }),
          versionSchema,
        );
        snapshot.selectedVersion = latest.data[0] ?? null;
      }
      if (screen.key === "photos" && snapshot.selectedVersion) {
        const transaction = await read(
          request,
          auth,
          `/api/transactions/${snapshot.selectedVersion.id}`,
          z.object({ data: z.object({ content: z.object({ media: z.array(z.object({
            id: z.string(), position: z.string(), created_at: z.string(),
            device_captured_at: z.string().nullable(), latitude: z.number().nullable(), longitude: z.number().nullable(),
            location_label: z.string().nullable().optional(), captured_at_source: z.string().nullable().optional(), location_source: z.string().nullable().optional(),
          })) }) }) }),
        );
        snapshot.workflow = {
          photos: transaction.data.content.media.map(photo => ({
            id: photo.id,
            versionId: snapshot.selectedVersion!.id,
            position: photo.position,
            name: photo.position,
            status: "saved" as const,
            note: "",
            receivedAt: photo.created_at,
            capturedAt: photo.device_captured_at ?? undefined,
            capturedAtSource: photo.captured_at_source ?? undefined,
            locationLabel: photo.location_label ?? undefined,
            locationSource: photo.location_source ?? undefined,
            latitude: photo.latitude ?? undefined,
            longitude: photo.longitude ?? undefined,
            src: `/api/transactions/${snapshot.selectedVersion!.id}/media/${photo.id}`,
          })),
          answers: [], disputes: [], shares: [], registration: {}, verification: {}, audit: [], management: [],
        };
      }
  }
  }

  return data(
    {
      snapshot,
      screen,
      csrf: auth.session.csrf_token,
      email: auth.session.user.email,
      preview: previewEnabled(),
      requestKey: crypto.randomUUID(),
    },
    { headers: auth.headers },
  );
}

const text = (max: number, optional = false) =>
  z
    .string()
    .refine(
      (s) => ((optional && !s) || !!s.trim()) && [...s].length <= max,
      `空白以外の文字を含む${max}文字以内で入力してください。`,
    );
const str = (form: FormData, key: string) =>
  typeof form.get(key) === "string" ? String(form.get(key)) : "";
class InvalidInput extends Error {
  constructor(public fields: Record<string, string[]>) {
    super("入力内容を確認してください。");
  }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new InvalidInput(
      z.flattenError(result.error).fieldErrors as Record<string, string[]>,
    );
  return result.data;
}

export async function mutateWorkspace(request: Request) {
  const auth = await businessAuth(request);
  const form = await request.formData();
  const intent = str(form, "intent");
  try {
    if (intent === "photo") {
      const versionId = parse(idSchema, form.get("versionId"));
      const response = await apiFetch(request, `/api/transactions/${versionId}/media`, auth.cookie, {
        method: "POST",
        headers: {
          Origin: request.headers.get("Origin") || "",
          Referer: request.headers.get("Referer") || "",
          "X-CSRF-Token": str(form, "_csrf"),
        },
        body: form,
      });
      if (!response.ok) {
        const parsed = errorSchema.safeParse(await response.json().catch(() => null));
        return data<CommandResult>({
          code: parsed.success ? parsed.data.error.code : "photo_upload_failed",
          error: "画像を保存できませんでした。入力内容を確認してください。",
          fields: parsed.success ? parsed.data.error.fields : undefined,
        }, { status: response.status, headers: auth.headers });
      }
      return data<CommandResult>({ message: "画像を保存しました。" }, { headers: auth.headers });
    }
    let method = "POST",
      path = "",
      body: object = {},
      destination = "";
    const id = (key: string) =>
      parse(z.object({ [key]: idSchema }), { [key]: form.get(key) })[
        key
      ] as string;
    if (intent === "createVehicle" || intent === "updateVehicle") {
      const values = parse(
        z.object({
          model_name: text(200, true),
          identifier: text(100, true),
          kind: z.enum(["plate_number", "vin", "chassis_number"]),
        }),
        {
          model_name: str(form, "model_name"),
          identifier: str(form, "identifier"),
          kind: str(form, "kind") || "plate_number",
        },
      );
      path = "/api/vehicles";
      body = {
        model_name: values.model_name || null,
        identifiers: values.identifier
          ? [{ kind: values.kind, value: values.identifier }]
          : [],
      };
      if (intent === "updateVehicle") {
        path += `/${id("vehicleId")}`;
        method = "PATCH";
        body = { model_name: values.model_name || null };
      }
      destination = "vehicles";
    } else if (intent === "createCase") {
      const values = parse(
        z.object({
          store_id: idSchema,
          vehicle_id: idSchema,
          case_type: z.enum(["rental", "dealer", "repair"]),
        }),
        Object.fromEntries(
          ["store_id", "vehicle_id", "case_type"].map((k) => [k, form.get(k)]),
        ),
      );
      const context = (
        await read(
          request,
          auth,
          "/api/context",
          z.object({ data: contextSchema }),
        )
      ).data;
      if (!context.configuration?.settings.businesses[values.case_type])
        return data<CommandResult>(
          {
            code: "configuration_unavailable",
            error:
              "この業態で利用できる設定がありません。管理者に確認してください。",
          },
          { status: 409, headers: auth.headers },
        );
      path = "/api/cases";
      body = {
        ...values,
        configuration_version_id: context.configuration.id,
        assignee_id:
          str(form, "assign_self") === "1" ? context.principal.staff_id : null,
      };
      destination = "cases";
    } else if (
      [
        "updateCase",
        "assignCase",
        "cancelCase",
        "createRecord",
        "updateDraft",
      ].includes(intent)
    ) {
      const caseId = id("caseId");
      const item = (
        await read(
          request,
          auth,
          `/api/cases/${caseId}`,
          z.object({ data: caseSchema }),
        )
      ).data;
      const context = (
        await read(
          request,
          auth,
          "/api/context",
          z.object({ data: contextSchema }),
        )
      ).data;
      const rules = rulesFor({ context }, item);
      path = `/api/cases/${caseId}`;
      if (intent === "cancelCase") {
        path += "/cancel";
        body = parse(z.object({ reason: text(2000) }), {
          reason: str(form, "reason"),
        });
      } else if (intent === "assignCase") {
        const assignment = parse(
          z.enum(["self", "unassigned"]),
          str(form, "assignment"),
        );
        method = "PATCH";
        body = {
          assignee_id:
            assignment === "self" ? context.principal.staff_id : null,
        };
      } else if (!rules)
        return data<CommandResult>(
          { code: "configuration_unavailable", error: "案件開始時の設定版を取得できないため、変更できません。" },
          { status: 409, headers: auth.headers },
        );
      else if (intent === "updateCase") {
        method = "PATCH";
        const stage = parse(text(100), str(form, "stage"));
        if (
          stage !== item.stage &&
          !rules.transitions[item.stage]?.includes(stage)
        )
          return data<CommandResult>(
            { code: "invalid_transition", error: "この段階には変更できません。" },
            { status: 409, headers: auth.headers },
          );
        body = { stage };
      } else {
        let existing = {},
          recordKind = str(form, "record_kind"),
          lockVersion = 0;
        if (intent === "updateDraft") {
          path += `/records/${id("recordId")}/versions/${id("versionId")}`;
          const version = (
            await read(request, auth, path, z.object({ data: versionSchema }))
          ).data;
          const record = (
            await read(
              request,
              auth,
              `/api/cases/${caseId}/records/${version.record_id}`,
              z.object({ data: recordSchema }),
            )
          ).data;
          if (
            version.status !== "draft" ||
            version.configuration_version_id !== item.configuration_version_id
          )
            return data<CommandResult>(
              { code: "version_not_editable", error: "この版は編集できません。" },
              { status: 409, headers: auth.headers },
            );
          recordKind = record.record_kind;
          existing = version.entries;
          lockVersion = parse(
            z.object({ lock_version: z.coerce.number().int().nonnegative() }),
            { lock_version: form.get("lock_version") },
          ).lock_version;
          if (lockVersion !== version.lock_version)
            return data<CommandResult>(
              {
                code: "version_conflict",
                error:
                  "別の更新が保存されています。入力を控えてから最新の版を開き、差分を確認してください。",
                fields: {},
              },
              { status: 409, headers: auth.headers },
            );
          path += "/entries";
          method = "PUT";
        } else path += "/records";
        if (!Object.hasOwn(rules.record_kinds, recordKind))
          throw new InvalidInput({
            record_kind: ["記録種別を選択してください。"],
          });
        const result = entriesFromForm(
          form,
          rules.record_kinds[recordKind].fields,
          existing,
        );
        if (Object.keys(result.fields).length)
          throw new InvalidInput(result.fields);
        body =
          intent === "createRecord"
            ? { record_kind: recordKind, entries: result.entries }
            : { lock_version: lockVersion, entries: result.entries };
        destination =
          intent === "createRecord" ? `cases/${caseId}/records` : "";
      }
    } else
      return data<CommandResult>(
        { code: "unsupported_operation", error: "この操作は現在利用できません。" },
        { status: 400, headers: auth.headers },
      );
    let response: Response;
    try {
      response = await apiFetch(request, path, auth.cookie, {
        method,
        headers: {
          Origin: request.headers.get("Origin") || "",
          Referer: request.headers.get("Referer") || "",
          "X-CSRF-Token": str(form, "_csrf"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      return data<CommandResult>(
        {
          code: "result_unknown",
          error:
            "保存結果が未確定です。一覧・詳細で結果を確認してから再操作してください。",
          uncertain: true,
        },
        { status: 503, headers: auth.headers },
      );
    }
    for (const cookie of response.headers.getSetCookie())
      auth.headers.append("Set-Cookie", cookie);
    const json: unknown = await response.json().catch(() => null);
    if (response.status === 401)
      throw redirect("/login", { headers: auth.headers });
    if (!response.ok) {
      const parsed = errorSchema.safeParse(json);
      const error = parsed.success ? parsed.data.error : undefined;
      const messages: Record<string, string> = {
        validation_error: "入力内容を確認してください。",
        forbidden: "この操作を行う権限がありません。",
        not_found: "対象が見つかりません。",
        version_conflict:
          "別の更新が保存されています。入力を控えてから最新の版を開き、差分を確認してください。",
        conflict:
          "現在の状態では保存できません。重複や案件の段階を確認してください。",
        timeout:
          "保存結果が未確定です。一覧・詳細で結果を確認してから再操作してください。",
      };
      return data<CommandResult>(
        {
          code: error?.code ?? "request_failed",
          error:
            messages[error?.code ?? ""] ??
            "保存できませんでした。結果を確認してから再操作してください。",
          fields: error?.fields,
          uncertain: response.status >= 500,
        },
        { status: response.status, headers: auth.headers },
      );
    }
    if (destination) {
      const parsed =
        intent === "createRecord"
          ? z
              .object({ data: z.object({ record: recordSchema }) })
              .safeParse(json)
          : z.object({ data: z.object({ id: idSchema }) }).safeParse(json);
      if (!parsed.success)
        return data<CommandResult>(
          {
            code: "result_unknown",
            error:
              "保存応答を確認できませんでした。結果が未確定のため、一覧で結果を確認してから再操作してください。",
            uncertain: true,
          },
          { status: 503, headers: auth.headers },
        );
      const resourceId =
        "record" in parsed.data.data
          ? parsed.data.data.record.id
          : parsed.data.data.id;
      return redirect(`/app/${destination}/${resourceId}`, {
        headers: auth.headers,
      });
    }
    return data<CommandResult>(
      { code: "saved", message: "保存しました。" },
      { headers: auth.headers },
    );
  } catch (error) {
    if (error instanceof InvalidInput)
      return data<CommandResult>(
        { code: "validation_error", error: error.message, fields: error.fields },
        { status: 400, headers: auth.headers },
      );
    throw error;
  }
}

export function unavailableScreen(screen: Screen) {
  return !coreScreens.has(screen.key);
}
