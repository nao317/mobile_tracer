import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DisplaySettingsProvider } from "../ui/display-settings";
import { AuthenticatedLayout, type NavigationGroup } from "./authenticated-layout";

function show(groups: NavigationGroup[], path = "/licenses") {
  const router = createMemoryRouter([{ path: "*", element: (
    <DisplaySettingsProvider initialLanguage="ja" initialTheme="light">
      <AuthenticatedLayout groups={groups}>Content</AuthenticatedLayout>
    </DisplaySettingsProvider>
  ) }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return screen.getByRole("navigation", { name: "メインナビゲーション" });
}

const settings = { id: "settings", label: "設定", items: [
  { id: "settings", label: "設定", to: "/settings" },
  { id: "display", label: "表示設定", to: "/settings/display" },
] };

describe("shared sidebar navigation", () => {
  it("places the license link directly after settings at the same level", () => {
    const nav = show([
      { id: "licenses", label: "OSSライセンス", items: [{ id: "licenses", label: "OSSライセンス", to: "/licenses" }] },
      settings,
      { id: "other", label: "Other", items: [{ id: "other", label: "Other", to: "/other" }] },
    ]);
    const group = within(nav).getByRole("button", { name: "設定" }).parentElement!;
    const link = within(nav).getByRole("link", { name: "OSSライセンス" });
    expect(group.nextElementSibling).toBe(link.parentElement);
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).not.toHaveAttribute("aria-expanded");
    expect(within(nav).queryByRole("button", { name: "OSSライセンス" })).toBeNull();
  });

  it("renders every single destination directly and retains groups with multiple links", () => {
    const nav = show([
      { id: "home", label: "ホーム", items: [{ id: "home", label: "ホーム", to: "/app" }] },
      settings,
    ]);
    expect(within(nav).getByRole("link", { name: "ホーム" })).toHaveAttribute("href", "/app");
    expect(within(nav).queryByRole("button", { name: "ホーム" })).toBeNull();
    expect(within(nav).getByRole("button", { name: "設定" })).toHaveAttribute("aria-expanded", "false");
    expect(within(nav).getByRole("link", { name: "OSSライセンス" })).toBeInTheDocument();
  });

  it("marks the longest matching business destination on nested pages", () => {
    const nav = show([
      { id: "home", label: "ホーム", items: [{ id: "home", label: "ホーム", to: "/app" }] },
      { id: "vehicles", label: "車両", items: [{ id: "vehicles", label: "車両", to: "/app/vehicles" }] },
      { id: "cases", label: "案件", items: [{ id: "cases", label: "案件", to: "/app/cases" }] },
    ], "/app/vehicles/new");
    expect(within(nav).getByRole("link", { name: "車両" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "ホーム" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getAllByRole("link").filter(link => link.getAttribute("aria-current") === "page")).toHaveLength(1);
  });

  it("opens multiple inactive navigation groups independently", () => {
    const nav = show([
      { id: "home", label: "ホーム", items: [{ id: "home", label: "ホーム", to: "/app" }] },
      { id: "vehicles", label: "車両", items: [{ id: "vehicles", label: "車両一覧", to: "/app/vehicles" }, { id: "records", label: "車両記録", to: "/transactions" }] },
      { id: "cases", label: "案件", items: [{ id: "cases", label: "案件一覧", to: "/app/cases" }, { id: "inbox", label: "受信履歴", to: "/casework/inbox" }] },
    ], "/app");
    const vehicles = within(nav).getByRole("button", { name: "車両" });
    const cases = within(nav).getByRole("button", { name: "案件" });
    fireEvent.click(vehicles);
    fireEvent.click(cases);
    expect(vehicles).toHaveAttribute("aria-expanded", "true");
    expect(cases).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("link", { name: "車両記録" })).toBeVisible();
    expect(within(nav).getByRole("link", { name: "受信履歴" })).toBeVisible();
  });
});
