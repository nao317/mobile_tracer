import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DisplaySettingsProvider } from "../ui/display-settings";
import { AuthenticatedLayout, type NavigationGroup } from "./authenticated-layout";

function show(groups: NavigationGroup[]) {
  const router = createMemoryRouter([{ path: "*", element: (
    <DisplaySettingsProvider initialLanguage="ja" initialTheme="light">
      <AuthenticatedLayout groups={groups}>Content</AuthenticatedLayout>
    </DisplaySettingsProvider>
  ) }], { initialEntries: ["/licenses"] });
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
});
