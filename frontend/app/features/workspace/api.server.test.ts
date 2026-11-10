// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWorkspace, mutateWorkspace, previewEnabled } from "./api.server";
import { createPreviewData, demoId } from "./preview-data";

const initial = createPreviewData();
const session = {
  user: { id: demoId(1), email: "fixture@example.com", email_verified: true },
  memberships: [],
  selected_staff_id: demoId(2),
  system_admin: false,
  csrf_token: "csrf-value",
};
function request(form?: FormData) {
  return new Request("http://app.example/app/actions", {
    method: form ? "POST" : "GET",
    headers: { Cookie: "mt_session=example", Origin: "http://app.example" },
    body: form,
  });
}
function fetchFixture(
  handler?: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
    const path = url.pathname;
    if (path === "/api/auth/me") return Response.json({ data: session });
    if (handler) return handler(`${path}${url.search}`, init);
    if (path === "/api/context")
      return Response.json({ data: initial.context });
    return new Response(null, { status: 503 });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("workspace server boundary", () => {
  it("only enables previews with an explicit development environment", () => {
    vi.stubEnv("ENABLE_UI_PREVIEW", "1");
    vi.stubEnv("APP_ENV", "production");
    expect(previewEnabled()).toBe(false);
    vi.stubEnv("APP_ENV", "development");
    expect(previewEnabled()).toBe(true);
    vi.stubEnv("ENABLE_UI_PREVIEW", "0");
    expect(previewEnabled()).toBe(false);
  });
  it("never substitutes sample data after a live API error", async () => {
    fetchFixture();
    const error = await loadWorkspace(request(), "vehicles").catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(503);
  });
  it("passes cookies and the submitted CSRF token to one vehicle mutation", async () => {
    const fetcher = fetchFixture((url, init) => {
      expect(url).toBe("/api/vehicles");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("Cookie")).toContain("mt_session=example");
      expect(headers.get("X-CSRF-Token")).toBe("submitted-csrf");
      expect(headers.get("Origin")).toBe("http://app.example");
      return Response.json({ data: { id: demoId(99) } }, { status: 201 });
    });
    const form = new FormData();
    for (const [k, v] of Object.entries({
      intent: "createVehicle",
      model_name: "サンプル",
      kind: "plate_number",
      identifier: "A",
      _csrf: "submitted-csrf",
    }))
      form.set(k, v);
    const response = await mutateWorkspace(request(form));
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe(
      `/app/vehicles/${demoId(99)}`,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("forwards live photo uploads as multipart data", async () => {
    const fetcher = fetchFixture((url, init) => {
      expect(url).toBe(`/api/transactions/${demoId(40)}/media`);
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
      return Response.json({ data: { id: demoId(41) } }, { status: 201 });
    });
    const form = new FormData();
    form.set("intent", "photo"); form.set("versionId", demoId(40)); form.set("_csrf", "submitted-csrf");
    form.set("photo", new File(["image"], "photo.png", { type: "image/png" }));
    const response = await mutateWorkspace(request(form));
    expect(response).not.toBeInstanceOf(Response);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not retry a mutation whose response was lost", async () => {
    const fetcher = fetchFixture(() => Promise.reject(new Error("network")));
    const form = new FormData();
    form.set("intent", "createVehicle");
    form.set("kind", "plate_number");
    form.set("model_name", "サンプル");
    const response = await mutateWorkspace(request(form));
    expect(response).not.toBeInstanceOf(Response);
    if (!(response instanceof Response))
      expect(response.data).toMatchObject({ uncertain: true, code: "result_unknown" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps a malformed success response uncertain rather than encouraging duplicate creation", async () => {
    fetchFixture(() => Response.json({ unexpected: true }));
    const form = new FormData();
    form.set("intent", "createVehicle");
    form.set("kind", "plate_number");
    const response = await mutateWorkspace(request(form));
    if (!(response instanceof Response))
      expect(response.data).toMatchObject({ uncertain: true, code: "result_unknown" });
  });
  it("rejects non-UUID resource paths before requesting business data", async () => {
    const fetcher = fetchFixture();
    const response = await loadWorkspace(request(), "cases/not-a-uuid").catch(
      (error: unknown) => error,
    );
    expect((response as Response).status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

function page<T>(items: T[], current = 1, total = items.length, size = 20) {
  return Response.json({ data: items, pagination: { page: current, page_size: size, total } });
}
function load(path: string, query = "") {
  return loadWorkspace(new Request(`http://app.example/app/${path}${query}`, {
    headers: { Cookie: "mt_session=example" },
  }), path);
}
const item = initial.cases[0];
const vehicle = initial.vehicles.find((v) => v.id === item.vehicle_id)!;
const record = initial.records.find((r) => r.case_id === item.id)!;
const version = initial.versions.find((v) => v.record_id === record.id)!;
const casePath = `cases/${item.id}`;
const recordPath = `${casePath}/records/${record.id}`;
function workspaceFixture(handler?: (url: URL) => Response | Promise<Response> | undefined) {
  return fetchFixture((path) => {
    const url = new URL(path, "http://api.example");
    const result = handler?.(url);
    if (result) return result;
    if (url.pathname === "/api/context") return Response.json({ data: initial.context });
    if (url.pathname === `/api/cases/${item.id}`) return Response.json({ data: item });
    if (url.pathname === `/api/vehicles/${vehicle.id}`) return Response.json({ data: vehicle });
    if (url.pathname === `/api/${recordPath}`) return Response.json({ data: record });
    throw new Error(`Unexpected fetch: ${url.pathname}${url.search}`);
  });
}
function paths(fetcher: ReturnType<typeof fetchFixture>) {
  return fetcher.mock.calls.map(([url]) => `${url.pathname}${url.search}`);
}

describe("workspace pagination and fetch planning", () => {
  it("loads persisted media for the live photo screen", async () => {
    workspaceFixture((url) => {
      if (url.pathname === `/api/${recordPath}/versions`) return page([version]);
      if (url.pathname === `/api/transactions/${version.id}`)
        return Response.json({ data: { content: { media: [{ id: demoId(990), position: "正面", created_at: "2026-11-09T00:00:00Z", device_captured_at: "2026-11-09T09:00:00+09:00", latitude: 33.59, longitude: 130.42, location_label: "博多駅", captured_at_source: "metadata", location_source: "search" }] } } });
    });
    const result = await load(`${recordPath}/photos`);
    expect(result.data.snapshot.workflow?.photos[0]).toMatchObject({ position: "正面", locationLabel: "博多駅", latitude: 33.59 });
    expect(result.data.requestKey).toMatch(/^[0-9a-f-]{36}$/);
  });
  it.each(["", "vehicles/new", "settings/usage"])("fetches no business collections for %s", async (path) => {
    const fetcher = workspaceFixture();
    const result = await load(path);
    expect(result.data.snapshot.vehicles).toEqual([]);
    expect(result.data.snapshot.cases).toEqual([]);
    expect(paths(fetcher)).toEqual(["/api/auth/me", "/api/context"]);
    expect(new Headers(result.init?.headers).get("Cache-Control")).toBe("no-store");
  });

  it("fetches only the requested vehicle page with search and metadata", async () => {
    const fetcher = workspaceFixture((url) => {
      if (url.pathname !== "/api/vehicles") return;
      expect(Object.fromEntries(url.searchParams)).toEqual({ page: "3", page_size: "20", q: "car & plate" });
      return page([vehicle], 3, 41);
    });
    const snapshot = (await load("vehicles", "?page=3&q=car%20%26%20plate")).data.snapshot;
    expect(snapshot.vehicles).toEqual([vehicle]);
    expect(snapshot.pagination).toEqual({ page: 3, page_size: 20, total: 41 });
    expect(snapshot.vehiclesPagination).toEqual(snapshot.pagination);
    expect(paths(fetcher)).toHaveLength(3);
  });

  it.each([21, 0])("normalizes an out-of-range vehicle list with total %s", async (total) => {
    const requested: number[] = [];
    workspaceFixture((url) => {
      if (url.pathname !== "/api/vehicles") return;
      const current = Number(url.searchParams.get("page"));
      requested.push(current);
      expect(url.searchParams.get("q")).toBe("car");
      return page(current === 2 ? [vehicle] : [], current, total);
    });
    const snapshot = (await load("vehicles", "?page=900&q=car")).data.snapshot;
    expect(requested).toEqual([900, total ? 2 : 1]);
    expect(snapshot.pagination?.page).toBe(total ? 2 : 1);
    expect(snapshot.vehicles).toEqual(total ? [vehicle] : []);
  });

  it("enriches only displayed cases and deduplicates their exact vehicle relations", async () => {
    const fetcher = workspaceFixture((url) => {
      if (url.pathname !== "/api/cases") return;
      expect(Object.fromEntries(url.searchParams)).toEqual({
        page: "2", page_size: "20", q: "car", case_type: "rental", status: "completed",
      });
      return page([item, { ...item, id: demoId(701) }], 2, 21);
    });
    const snapshot = (await load("cases", "?page=2&q=car&case_type=rental&status=completed")).data.snapshot;
    expect(snapshot.vehicles).toEqual([vehicle]);
    expect(snapshot.casesPagination).toEqual({ page: 2, page_size: 20, total: 21 });
    expect(paths(fetcher)).toHaveLength(4);
  });

  it("bounds vehicle request concurrency and resolves every displayed relation", async () => {
    const cases = Array.from({ length: 20 }, (_, index) => ({
      ...item, id: demoId(800 + index), vehicle_id: demoId(900 + index),
    }));
    let active = 0, maximum = 0;
    workspaceFixture((url) => {
      if (url.pathname === "/api/cases") return page(cases, 1, 300);
      if (url.pathname.startsWith("/api/vehicles/")) return (async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return Response.json({ data: { ...vehicle, id: url.pathname.split("/").at(-1) } });
      })();
    });
    const snapshot = (await load("cases")).data.snapshot;
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(snapshot.vehicles.map((v) => v.id)).toEqual(cases.map((c) => c.vehicle_id));
  });

  it("searches and pages case-creation vehicles without injecting the selected vehicle", async () => {
    const other = { ...vehicle, id: demoId(702) };
    const fetcher = workspaceFixture((url) => {
      if (url.pathname !== "/api/vehicles") return;
      expect(Object.fromEntries(url.searchParams)).toEqual({ page: "2", page_size: "20", q: "other" });
      return page([other], 2, 21);
    });
    const snapshot = (await load("cases/new", `?page=2&q=other&vehicle=${vehicle.id}`)).data.snapshot;
    expect(snapshot.vehicles).toEqual([other]);
    expect(snapshot.selectedVehicle).toEqual(vehicle);
    expect(snapshot.pagination?.total).toBe(21);
    expect(paths(fetcher)).toHaveLength(4);
  });

  it("reuses a selected vehicle already on the page", async () => {
    const fetcher = workspaceFixture((url) => url.pathname === "/api/vehicles" ? page([vehicle]) : undefined);
    const snapshot = (await load("cases/new", `?vehicle=${vehicle.id}`)).data.snapshot;
    expect(snapshot.selectedVehicle).toEqual(vehicle);
    expect(paths(fetcher)).toHaveLength(3);
  });

  it("normalizes relatedPage independently of every other page key", async () => {
    const requested: number[] = [];
    const fetcher = workspaceFixture((url) => {
      if (url.pathname !== "/api/cases") return;
      expect(url.searchParams.get("vehicle_id")).toBe(vehicle.id);
      expect(url.searchParams.get("page_size")).toBe("20");
      const current = Number(url.searchParams.get("page"));
      requested.push(current);
      return page(current === 3 ? [item] : [], current, 41);
    });
    const snapshot = (await load(`vehicles/${vehicle.id}`, "?relatedPage=9&page=7&recordsPage=4&historyPage=2")).data.snapshot;
    expect(requested).toEqual([9, 3]);
    expect(snapshot.cases).toEqual([item]);
    expect(snapshot.relatedPagination).toEqual({ page: 3, page_size: 20, total: 41 });
    expect(snapshot.notice).toBeUndefined();
    expect(paths(fetcher)).toHaveLength(5);
  });

  it("fetches no related cases for the vehicle edit view", async () => {
    const fetcher = workspaceFixture();
    const snapshot = (await load(`vehicles/${vehicle.id}`, "?view=edit&relatedPage=invalid")).data.snapshot;
    expect(snapshot.vehicles).toEqual([vehicle]);
    expect(snapshot.cases).toEqual([]);
    expect(snapshot.relatedPagination).toBeUndefined();
    expect(paths(fetcher)).toHaveLength(3);
  });

  it("normalizes recordsPage independently and retains metadata", async () => {
    const requested: number[] = [];
    workspaceFixture((url) => {
      if (url.pathname !== `/api/${casePath}/records`) return;
      const current = Number(url.searchParams.get("page"));
      requested.push(current);
      expect(url.searchParams.get("page_size")).toBe("20");
      return page(current === 2 ? [record] : [], current, 21);
    });
    const snapshot = (await load(`${casePath}/records`, "?recordsPage=9&page=4&relatedPage=7&historyPage=6")).data.snapshot;
    expect(requested).toEqual([9, 2]);
    expect(snapshot.records).toEqual([record]);
    expect(snapshot.recordsPagination).toEqual({ page: 2, page_size: 20, total: 21 });
    expect(snapshot.versions).toEqual([]);
  });

  it.each([casePath, `${casePath}/manage`, `${casePath}/records/new`])("does not fetch records for %s", async (path) => {
    const fetcher = workspaceFixture();
    expect((await load(path)).data.snapshot.records).toEqual([]);
    expect(paths(fetcher)).toHaveLength(4);
  });

  it("keeps the default latest version independent of the history page", async () => {
    const latest = { ...version, id: demoId(703), version_no: 41 };
    workspaceFixture((url) => {
      if (url.pathname !== `/api/${recordPath}/versions`) return;
      expect(url.searchParams.get("sort")).toBe("-version_no");
      if (url.searchParams.get("page_size") === "1") return page([latest], 1, 41, 1);
      expect(url.searchParams.get("page_size")).toBe("20");
      expect(url.searchParams.get("page")).toBe("2");
      return page([version], 2, 41);
    });
    const snapshot = (await load(`${recordPath}/history`, "?historyPage=2&recordsPage=9&relatedPage=8&page=7")).data.snapshot;
    expect(snapshot.versions).toEqual([version]);
    expect(snapshot.selectedVersion).toEqual(latest);
    expect(snapshot.historyPagination).toEqual({ page: 2, page_size: 20, total: 41 });
  });

  it.each([false, true])("resolves explicit version without modifying history (on-page=%s)", async (onPage) => {
    const selected = onPage ? version : { ...version, id: demoId(704), version_no: 3 };
    const fetcher = workspaceFixture((url) => {
      if (url.pathname === `/api/${recordPath}/versions`) return page([version], 2, 41);
      if (url.pathname === `/api/${recordPath}/versions/${selected.id}`) return Response.json({ data: selected });
    });
    const snapshot = (await load(`${recordPath}/history`, `?historyPage=2&version=${selected.id}`)).data.snapshot;
    expect(snapshot.versions).toEqual([version]);
    expect(snapshot.selectedVersion).toEqual(selected);
    expect(paths(fetcher).filter((path) => path.includes("/versions"))).toHaveLength(onPage ? 1 : 2);
  });

  it("resolves default version after normalizing historyPage", async () => {
    const requested: number[] = [];
    workspaceFixture((url) => {
      if (url.pathname !== `/api/${recordPath}/versions`) return;
      const current = Number(url.searchParams.get("page"));
      requested.push(current);
      return page(current === 1 ? [version] : [], current, 1);
    });
    const snapshot = (await load(`${recordPath}/history`, "?historyPage=99")).data.snapshot;
    expect(requested).toEqual([99, 1]);
    expect(snapshot.versions).toEqual([version]);
    expect(snapshot.selectedVersion).toEqual(version);
    expect(snapshot.historyPagination?.page).toBe(1);
  });

  it("represents an empty history with no selected version", async () => {
    workspaceFixture((url) => url.pathname === `/api/${recordPath}/versions` ? page([]) : undefined);
    const snapshot = (await load(`${recordPath}/history`)).data.snapshot;
    expect(snapshot.versions).toEqual([]);
    expect(snapshot.selectedVersion).toBeNull();
  });

  it.each([false, true])("fetches only the selected edit version (explicit=%s)", async (explicit) => {
    const fetcher = workspaceFixture((url) => {
      if (explicit && url.pathname === `/api/${recordPath}/versions/${version.id}`) return Response.json({ data: version });
      if (!explicit && url.pathname === `/api/${recordPath}/versions`) {
        expect(Object.fromEntries(url.searchParams)).toEqual({ page: "1", page_size: "1", sort: "-version_no" });
        return page([version], 1, 60, 1);
      }
    });
    const snapshot = (await load(`${recordPath}/edit`, `?historyPage=99${explicit ? `&version=${version.id}` : ""}`)).data.snapshot;
    expect(snapshot.selectedVersion).toEqual(version);
    expect(snapshot.versions).toEqual([]);
    expect(snapshot.historyPagination).toBeUndefined();
    expect(paths(fetcher)).toHaveLength(6);
  });

  it.each(["0", "-1", "1.5", "1000001", "oops"])("rejects invalid page %s", async (value) => {
    const fetcher = workspaceFixture();
    const error = await load("vehicles", `?page=${value}`).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(400);
    expect(paths(fetcher)).toHaveLength(2);
  });

  it("preserves relation authorization failures instead of guessing display data", async () => {
    workspaceFixture((url) => {
      if (url.pathname === "/api/cases") return page([item]);
      if (url.pathname === `/api/vehicles/${vehicle.id}`) return new Response(null, { status: 403 });
    });
    const error = await load("cases").catch((error: unknown) => error);
    expect((error as Response).status).toBe(403);
    expect((error as Response).headers.get("Cache-Control")).toBe("no-store");
  });

  it("redirects expired collection requests to login", async () => {
    workspaceFixture((url) => url.pathname === "/api/vehicles" ? new Response(null, { status: 401 }) : undefined);
    const error = await load("vehicles").catch((error: unknown) => error);
    expect((error as Response).headers.get("Location")).toBe("/login");
  });
});

function command(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return request(form);
}
describe("workspace command codes and locks", () => {
  it("preserves API error codes, fields, status and existing display messages", async () => {
    fetchFixture(() => Response.json({
      error: { code: "validation_error", fields: { model_name: ["API detail"] } },
    }, { status: 422 }));
    const response = await mutateWorkspace(command({ intent: "createVehicle", kind: "plate_number" }));
    expect(response).not.toBeInstanceOf(Response);
    if (!(response instanceof Response)) {
      expect(response.init?.status).toBe(422);
      expect(response.data).toEqual({
        code: "validation_error", error: "入力内容を確認してください。",
        fields: { model_name: ["API detail"] }, uncertain: false,
      });
    }
  });

  it("exposes unknown API codes for localization without discarding the error", async () => {
    fetchFixture(() => Response.json({ error: { code: "backend_specific" } }, { status: 409 }));
    const response = await mutateWorkspace(command({ intent: "createVehicle", kind: "plate_number" }));
    if (!(response instanceof Response)) expect(response.data).toMatchObject({
      code: "backend_specific", error: "保存できませんでした。結果を確認してから再操作してください。",
    });
  });

  it("falls back to a stable code for malformed API rejections", async () => {
    fetchFixture(() => new Response(null, { status: 500 }));
    const response = await mutateWorkspace(command({ intent: "createVehicle", kind: "plate_number" }));
    if (!(response instanceof Response)) expect(response.data).toMatchObject({ code: "request_failed", uncertain: true });
  });

  it("returns a stable local validation code and field names without a mutation", async () => {
    const fetcher = fetchFixture();
    const response = await mutateWorkspace(command({ intent: "createCase" }));
    if (!(response instanceof Response)) {
      expect(response.data.code).toBe("validation_error");
      expect(response.data.fields).toHaveProperty("vehicle_id");
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns a stable code for unsupported commands", async () => {
    fetchFixture();
    const response = await mutateWorkspace(command({ intent: "not-supported" }));
    if (!(response instanceof Response)) expect(response.data.code).toBe("unsupported_operation");
  });

  it.each([false, true])("preserves optimistic locks and untouched draft entries (stale=%s)", async (stale) => {
    const draft = initial.versions.find((v) => v.case_id === item.id && v.status === "draft")!;
    const draftRecord = initial.records.find((r) => r.id === draft.record_id)!;
    const fetcher = fetchFixture((path, init) => {
      if (path === "/api/context") return Response.json({ data: initial.context });
      if (path === `/api/${casePath}`) return Response.json({ data: item });
      if (path.endsWith(`/versions/${draft.id}`)) return Response.json({ data: draft });
      if (path.endsWith(`/records/${draftRecord.id}`)) return Response.json({ data: draftRecord });
      expect(init?.method).toBe("PUT");
      expect(path).toBe(`/api/${casePath}/records/${draft.record_id}/versions/${draft.id}/entries`);
      const body = JSON.parse(String(init?.body));
      expect(body.lock_version).toBe(draft.lock_version);
      expect(body.entries).toEqual({ ...draft.entries, odometer: 0 });
      return Response.json({ data: draft });
    });
    const response = await mutateWorkspace(command({
      intent: "updateDraft", caseId: item.id, recordId: draft.record_id,
      versionId: draft.id, lock_version: String(draft.lock_version + (stale ? 1 : 0)),
      "entry:odometer": "0",
    }));
    expect(response).not.toBeInstanceOf(Response);
    if (!(response instanceof Response)) {
      expect(response.data.code).toBe(stale ? "version_conflict" : "saved");
      if (stale) expect(response.init?.status).toBe(409);
      else expect(response.data.message).toBe("保存しました。");
    }
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(stale ? 0 : 1);
  });
});
