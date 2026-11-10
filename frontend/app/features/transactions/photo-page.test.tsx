import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DisplaySettingsProvider } from "../../components/ui/display-settings";
import { createPreviewData } from "../workspace/preview-data";
import type { Transaction } from "./model";
import { PhotoPage } from "./photo-page";

function show(
  status: Transaction["content"]["case"]["status"],
  versionStatus: "draft" | "submitted" = "draft",
) {
  const snapshot = createPreviewData();
  const item: Transaction = {
    api_configured: true,
    content: {
      schema: "v1",
      presented_at: null,
      version: { ...snapshot.versions[0], status: versionStatus },
      case: { ...snapshot.cases[0], status },
      vehicle: snapshot.vehicles[0],
      media: [],
    },
    requests: [],
    anchor: null,
    can_manage: true,
  };
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <DisplaySettingsProvider initialLanguage="ja" initialTheme="light">
          <PhotoPage item={item} csrf="csrf" requestKey="request-key" />
        </DisplaySettingsProvider>
      ),
    },
  ]);
  render(<RouterProvider router={router} />);
  return item;
}

describe("photo upload availability", () => {
  it("explains that customer start approval is required before uploading", () => {
    const item = show("awaiting_customer");
    expect(screen.queryByRole("button", { name: "写真を保存する" })).toBeNull();
    expect(screen.getByText(/顧客の開始承認待ちです/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "案件開始の条件を顧客へ提示する" }),
    ).toHaveAttribute("href", `/casework/new?case=${item.content.case.id}`);
  });

  it("allows photos for a draft in an active case", () => {
    show("in_progress");
    expect(screen.getByRole("button", { name: "写真を保存する" })).toBeEnabled();
    expect(screen.getByLabelText("撮影日時")).toBeRequired();
    expect(screen.getByLabelText("確定した撮影場所")).toBeRequired();
    expect(screen.getByLabelText("撮影箇所")).toHaveDisplayValue("正面");
    expect(screen.getByRole("option", { name: "左前" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/緯度|経度/)).toBeNull();
  });

  it.each(["completed", "cancelled"] as const)(
    "explains why a %s case cannot receive photos",
    (status) => {
      show(status);
      expect(screen.queryByRole("button", { name: "写真を保存する" })).toBeNull();
      expect(screen.getByText("完了・中止した案件には画像を追加できません。")).toBeInTheDocument();
    },
  );

  it("does not allow additions to a submitted version", () => {
    show("in_progress", "submitted");
    expect(screen.queryByRole("button", { name: "写真を保存する" })).toBeNull();
  });
});
