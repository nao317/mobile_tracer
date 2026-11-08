import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { DisplaySettingsProvider } from "../components/ui/display-settings";
import { CompanyFields, RequestDetails, ActionNotice } from "../features/management/shared";
import { UserListPage } from "../features/management/user-pages";
import type { ManagementRequest } from "../features/management/model";
import type { ReactNode } from "react";
function view(children: ReactNode) {
  const router = createMemoryRouter([{ path: "*", element: children }], { initialEntries: ["/admin/users"] });
  return render(<DisplaySettingsProvider initialLanguage="en" initialTheme="light"><RouterProvider router={router} /></DisplaySettingsProvider>);
}
describe("management semantic translations", () => {
  it("translates form labels, filters, enum values, and table accessibility labels", () => {
    view(<><CompanyFields /><UserListPage page={{ pagination: { page: 1, page_size: 20, total: 1 }, data: [{ id: "user", display_name: "日本のユーザー", email: "person@example.com", email_verified: true, account_type: "business", status: "active", created_at: "2026-11-08T00:00:00Z", version: 1 }] }} /></>);
    expect(screen.getByLabelText("Company display name")).toBeInTheDocument();
    expect(screen.getByLabelText("Rental and car sharing")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Account type" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Business user" })).toHaveAttribute("data-label", "Type");
    expect(screen.getByRole("cell", { name: "Verified" })).toBeInTheDocument();
    expect(screen.getByText("日本のユーザー")).toBeInTheDocument();
    expect(screen.queryByText("業者ユーザー")).not.toBeInTheDocument();
  });
  it("formats request dates in Tokyo and preserves applicant-authored content", () => {
    const request: ManagementRequest = { id: "request", requester_id: "person", request_key: "key", kind: "company_create", status: "pending", company_id: null, payload: { name: "企業名はそのまま", profile: { business_types: ["rental", "repair"] } }, created_at: "2026-11-08T18:30:00Z", decided_by: null, decided_at: null, decision_reason: "" };
    view(<RequestDetails request={request} />);
    expect(screen.getByText("Create company and profile")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("企業名はそのまま")).toBeInTheDocument();
    expect(screen.getByText(/Nov 9, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Rental and car sharing and Maintenance and repair")).toBeInTheDocument();
  });
  it("uses stable feedback codes and hides raw API messages", () => {
    view(<ActionNotice result={{ code: "conflict", error: "内部のエラーメッセージ", fields: { "profile.name": ["非公開の詳細"] } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Cannot save in the current state");
    expect(screen.getByRole("alert")).toHaveTextContent("Name: Check this field.");
    expect(screen.queryByText("内部のエラーメッセージ")).not.toBeInTheDocument();
    expect(screen.queryByText("非公開の詳細")).not.toBeInTheDocument();
  });
});
