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
    if (handler) return handler(path, init);
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
  it("does not retry a mutation whose response was lost", async () => {
    const fetcher = fetchFixture(() => Promise.reject(new Error("network")));
    const form = new FormData();
    form.set("intent", "createVehicle");
    form.set("kind", "plate_number");
    form.set("model_name", "サンプル");
    const response = await mutateWorkspace(request(form));
    expect(response).not.toBeInstanceOf(Response);
    if (!(response instanceof Response))
      expect(response.data.uncertain).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps a malformed success response uncertain rather than encouraging duplicate creation", async () => {
    fetchFixture(() => Response.json({ unexpected: true }));
    const form = new FormData();
    form.set("intent", "createVehicle");
    form.set("kind", "plate_number");
    const response = await mutateWorkspace(request(form));
    if (!(response instanceof Response))
      expect(response.data.uncertain).toBe(true);
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
