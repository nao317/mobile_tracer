import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { Pagination } from "./pagination";
import { DisplaySettingsProvider } from "../ui/display-settings";

function show(total: number, page = 1, pageKey = "page", language: "ja" | "en" = "ja") {
  const router = createMemoryRouter([{ path: "*", element: <DisplaySettingsProvider initialLanguage={language} initialTheme="light"><Pagination pagination={{ total, page, page_size: 20 }} pageKey={pageKey} /></DisplaySettingsProvider> }], { initialEntries: [`/app/cases/example/records/record/history?q=car&version=selected&${pageKey}=${page}`] });
  render(<RouterProvider router={router} />);
  return screen.getByRole("navigation", { name: language === "ja" ? "ページ切り替え" : "Pagination" });
}
describe("shared pagination", () => {
  it.each([0, 1, 20])("disables both directions for a single page with %s rows", total => {
    const nav = show(total);
    expect(within(nav).queryByRole("link")).not.toBeInTheDocument();
    expect(within(nav).getByText("前へ")).toHaveAttribute("aria-disabled", "true");
    expect(within(nav).getByText("次へ")).toHaveAttribute("aria-disabled", "true");
    expect(within(nav).getByRole("status")).toHaveTextContent(total ? `全${total}件中 1〜${total}件` : "全0件中 0〜0件");
  });
  it("retains filters and selected version with an independent history page", () => {
    const nav = show(101, 2, "historyPage");
    const next = new URL(within(nav).getByRole("link", { name: "次へ" }).getAttribute("href")!, "http://local");
    expect(next.searchParams.get("historyPage")).toBe("3");
    expect(next.searchParams.get("version")).toBe("selected");
    expect(next.searchParams.get("q")).toBe("car");
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent("2");
    expect(within(nav).getByRole("status")).toHaveTextContent("全101件中 21〜40件");
  });
  it("keeps the last page truthful and limits page number links", () => {
    const nav = show(10001, 501, "page", "en");
    expect(within(nav).getByText("Next")).toHaveAttribute("aria-disabled", "true");
    expect(within(nav).getByRole("status")).toHaveTextContent("10,001–10,001 of 10,001");
    expect(within(nav).getAllByRole("link").length).toBeLessThan(8);
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent("501");
  });
});
