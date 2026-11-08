import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { DisplaySettingsProvider } from "../../../components/ui/display-settings";
import { createPreviewData, demoId } from "../preview-data";
import { WorkspaceProvider } from "../workspace-context";
import { AuditScreen, ConfigurationScreen, DeletionScreen, EnvironmentsScreen, ImportsScreen, OrganizationScreen, SupportAccessScreen, SupportScreen, UsageScreen } from "../management-screens";
import { clientPage } from "./common";
import { inspectCsv } from "./imports-page";

function setup(element: ReactNode, query = "", snapshot = createPreviewData(), language: "ja" | "en" = "en") {
  const execute = vi.fn(() => ({ code: "preview_saved", message: "original message" }));
  const router = createMemoryRouter([{ path: "*", element:
    <DisplaySettingsProvider initialLanguage={language} initialTheme="light">
      <WorkspaceProvider value={{ mode: "preview", snapshot, base: "/preview", csrf: "csrf", email: "preview@example.com", previewAvailable: true, execute }}>{element}</WorkspaceProvider>
    </DisplaySettingsProvider>,
  }], { initialEntries: [`/preview/test${query}`] });
  render(<RouterProvider router={router} />);
  return { router, execute };
}
function managementItems(kind: string, total: number) {
  const source = createPreviewData();
  source.workflow!.management = Array.from({ length: total }, (_, index) => ({
    id: demoId(700 + index), kind, name: `Entry ${String(index + 1).padStart(2, "0")}`,
    detail: "Test detail", status: "有効", history: Array.from({ length: 43 }, (_, n) => `History ${n + 1}`),
  }));
  return source;
}

describe("preview management pagination", () => {
  it("slices 20 items, normalizes invalid pages, and preserves the input", () => {
    const items = Array.from({ length: 45 }, (_, n) => n);
    expect(clientPage(items, "2")).toEqual({ items: items.slice(20, 40), pagination: { page: 2, page_size: 20, total: 45 } });
    expect(clientPage(items, "999").items).toEqual([40, 41, 42, 43, 44]);
    expect(clientPage(items, "-1").pagination.page).toBe(1);
    expect(clientPage([], "8").pagination).toEqual({ page: 1, page_size: 20, total: 0 });
    expect(items).toHaveLength(45);
  });
  it("shows only the current page and retains its URL through edit and back", async () => {
    const { router } = setup(<OrganizationScreen />, "?view=stores&page=2&q=kept", managementItems("store", 45));
    expect(screen.getAllByRole("article")).toHaveLength(20);
    expect(screen.getByText("Entry 21")).toBeInTheDocument();
    expect(screen.queryByText("Entry 01")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("link", { name: "Review details" })[0]);
    await screen.findByRole("heading", { name: "Edit" });
    expect(router.state.location.search).toContain("page=2");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Back to list" }));
    await screen.findByText("Entry 21");
    expect(router.state.location.search).toContain("q=kept");
    expect(router.state.location.search).toContain("page=2");
  });
  it("normalizes a stale page after filtering without dropping other URL state", async () => {
    const { router } = setup(<OrganizationScreen />, "?view=stores&page=999&q=kept", managementItems("store", 21));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    await waitFor(() => expect(router.state.location.search).toContain("page=2"));
    expect(router.state.location.search).toContain("q=kept");
  });
  it("paginates item history separately from its list page", () => {
    const source = managementItems("staff", 1);
    setup(<OrganizationScreen />, `?view=staff-history&item=${source.workflow!.management[0].id}&page=7&historyPage=2`, source);
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getByText("History 21")).toBeInTheDocument();
    expect(screen.queryByText("History 1")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", expect.stringContaining("historyPage=3"));
  });
  it("paginates audit results and resets the page when a new search is submitted", async () => {
    const source = createPreviewData();
    source.workflow!.audit = Array.from({ length: 41 }, (_, n) => ({ id: demoId(700 + n), at: "2026-01-01T00:00:00Z", actor: `Actor ${n + 1}`, action: "manage", target: "Test" }));
    const { router } = setup(<AuditScreen />, "?page=2", source);
    expect(screen.getAllByRole("row")).toHaveLength(21);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Actor 41" } });
    fireEvent.submit(screen.getByRole("button", { name: "Search" }).closest("form")!);
    await waitFor(() => expect(router.state.location.search).toContain("q=Actor+41"));
    expect(router.state.location.search).not.toContain("page=");
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });
});

describe("preview management URL views and localization", () => {
  it("keeps the store list separate from its create form and preserves the command values", async () => {
    const { execute } = setup(<OrganizationScreen />, "?view=stores-new");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Store name"), { target: { value: "New store" } });
    fireEvent.change(screen.getByLabelText("Business activities"), { target: { value: "Rental" } });
    fireEvent.submit(screen.getByRole("button", { name: "Add store" }).closest("form")!);
    await waitFor(() => expect(execute).toHaveBeenCalledOnce());
    const submitted = execute.mock.calls[0] as unknown as [FormData];
    expect(Object.fromEntries(submitted[0])).toMatchObject({ intent: "manage", kind: "store", status: "有効", name: "New store", detail: "Rental" });
  });
  it("translates roles while keeping persisted invitation values", () => {
    setup(<OrganizationScreen />, "?view=staff-new");
    expect(screen.getByRole("option", { name: "Company administrator" })).toHaveValue("企業管理者");
    expect(screen.getByLabelText("Staff email address")).toBeInTheDocument();
  });
  it("renders Japanese labels from the same semantic catalog", () => {
    setup(<OrganizationScreen />, "?view=stores-new", createPreviewData(), "ja");
    expect(screen.getByLabelText("店舗名")).toBeInTheDocument();
    expect(screen.queryByLabelText("Store name")).not.toBeInTheDocument();
  });
  it.each([
    [<SupportScreen />, "Support permissions"],
    [<DeletionScreen />, "Deletion requests"],
    [<EnvironmentsScreen />, "Environments"],
  ])("keeps list views free of create forms for %s", (element, title) => {
    setup(element);
    expect(screen.getByRole("heading", { name: String(title) })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("keeps configuration current, editing, preview and history as separate views", async () => {
    const { router } = setup(<ConfigurationScreen />);
    expect(screen.getByRole("heading", { name: "Current configuration" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Configuration name")).not.toBeInTheDocument();
    await act(() => router.navigate("?view=edit"));
    expect(screen.getByLabelText("Configuration name")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await act(() => router.navigate("?view=history"));
    expect(screen.getByRole("heading", { name: "Configuration history" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Configuration name")).not.toBeInTheDocument();
  });
  it("separates usage totals from unmeasured capacity", async () => {
    const { router } = setup(<UsageScreen />);
    expect(screen.getByText("Cases")).toBeInTheDocument();
    expect(screen.queryByText(/Storage measurements are unavailable/)).not.toBeInTheDocument();
    await act(() => router.navigate("?view=capacity"));
    expect(screen.queryByText("Cases")).not.toBeInTheDocument();
    expect(screen.getByText(/Storage measurements are unavailable/)).toBeInTheDocument();
  });
  it("checks the permission again when opening a support record directly", () => {
    const source = managementItems("support", 1);
    source.workflow!.management[0].status = "取消済み";
    setup(<SupportAccessScreen />, `?view=record&item=${source.workflow!.management[0].id}`, source);
    expect(screen.getByRole("heading", { name: "No active support permission" })).toBeInTheDocument();
    expect(screen.queryByText("Support access: read only")).not.toBeInTheDocument();
  });
});

describe("CSV validation and result paging", () => {
  it("validates all rows including duplicates beyond the former 100 row limit", () => {
    const csv = ["model_name,plate_number", ...Array.from({ length: 120 }, (_, n) => `Model ${n},Plate ${n}`), "Duplicate,Plate 0"].join("\n");
    const rows = inspectCsv(csv);
    expect(rows).toHaveLength(121);
    expect(rows.at(-1)).toMatchObject({ line: 122, errorCode: "duplicate", error: "CSV内に同じナンバーがあります。" });
    expect(inspectCsv("wrong_header")[0].errorCode).toBe("header");
  });
  it("separates source, paginated results and import history while preserving source", async () => {
    const { router } = setup(<ImportsScreen />, "?view=new");
    const csv = ["model_name,plate_number", ...Array.from({ length: 45 }, (_, n) => `Model ${n},Plate ${n}`)].join("\n");
    fireEvent.change(screen.getByLabelText("CSV content"), { target: { value: csv } });
    fireEvent.click(screen.getByRole("button", { name: "Run trial and review rows" }));
    await waitFor(() => expect(router.state.location.search).toContain("view=preview"));
    expect(screen.queryByLabelText("CSV content")).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(21);
    fireEvent.click(screen.getByRole("link", { name: "Next" }));
    await screen.findByText("Model 20");
    expect(screen.queryByText("Model 0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Trial a small CSV import" }));
    expect(await screen.findByLabelText("CSV content")).toHaveValue(csv);
  });
});

describe("configuration rule type and trial rendering", () => {
  it.each(["ja", "en"] as const)("localizes every rule type in %s", (language) => {
    setup(<ConfigurationScreen />, "?view=current", createPreviewData(), language);
    const labels = language === "ja" ? ["文字列", "整数", "数値", "真偽値"] : ["Text", "Integer", "Number", "Boolean"];
    for (const label of labels) expect(screen.getAllByRole("cell", { name: label }).length).toBeGreaterThan(0);
  });
  it("shows trial differences separately from history before applying", async () => {
    const { createPreviewManagementReviewData } = await import("./view-catalog");
    setup(<ConfigurationScreen />, `?view=preview&item=${demoId(900)}`, createPreviewManagementReviewData());
    expect(screen.getByRole("heading", { name: "Changes" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Required on submission" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Optional" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply configuration" })).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
  it("does not offer applying an unreadable trial configuration", async () => {
    const { createPreviewManagementReviewData } = await import("./view-catalog");
    const source = createPreviewManagementReviewData();
    source.workflow!.management.find((item) => item.id === demoId(900))!.detail = "invalid-json";
    setup(<ConfigurationScreen />, `?view=preview&item=${demoId(900)}`, source);
    expect(screen.getByRole("alert")).toHaveTextContent("The trial configuration could not be read.");
    expect(screen.queryByRole("button", { name: "Apply configuration" })).not.toBeInTheDocument();
  });
});
