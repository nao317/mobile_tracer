// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoId } from "../workspace/preview-data";
import { transactionAction } from "./api.server";

afterEach(() => vi.unstubAllGlobals());

async function upload(response: Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: URL, init?: RequestInit) => {
    if (url.pathname === "/api/auth/me")
      return Response.json({ data: {
        user: { id: demoId(1), email: "fixture@example.com", email_verified: true },
        memberships: [],
        selected_staff_id: demoId(2),
        system_admin: false,
        csrf_token: "csrf",
      } });
    expect(url.pathname).toBe(`/api/transactions/${demoId(3)}/media`);
    expect(init?.body).toBeInstanceOf(FormData);
    return response;
  }));
  const form = new FormData();
  form.set("intent", "photo");
  form.set("_csrf", "csrf");
  form.set("position", "front");
  form.set("request_key", demoId(4));
  form.set("photo", new File(["image"], "photo.png", { type: "image/png" }));
  return transactionAction(new Request("https://app.example/transactions/photos", {
    method: "POST",
    headers: { Cookie: "mt_session=example", Origin: "https://app.example" },
    body: form,
  }), demoId(3));
}

describe("photo upload error feedback", () => {
  it("preserves the API state conflict instead of blaming format or size", async () => {
    const message = "進行中の下書きにだけ画像を追加できます。";
    const result = await upload(Response.json({ error: { message, fields: {} } }, { status: 409 }));
    expect(result).toMatchObject({ data: { error: message }, init: { status: 409 } });
  });

  it("shows specific validation feedback from the API", async () => {
    const message = "画像の上限は10MBです。";
    const result = await upload(Response.json({ error: {
      message: "入力内容を確認してください。", fields: { photo: [message] },
    } }, { status: 400 }));
    expect(result).toMatchObject({ data: { error: message }, init: { status: 400 } });
  });

  it("handles a non-JSON error without inventing a cause", async () => {
    const result = await upload(new Response("Bad Gateway", { status: 502 }));
    expect(result).toMatchObject({ data: { error: "画像を保存できませんでした。最新の状態を確認してください。" } });
  });
});
