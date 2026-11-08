import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { CompanyMembersPage } from "./company-pages";
import { MyCompaniesPage, UpgradeRequestPage, CompanyCreateRequestPage, ProfileRequestPage } from "./my-request-pages";
import { UserDetailPage } from "./user-pages";
import { companySchema, managementRequestSchema, type Company, type Member } from "./model";
import type { ReactNode } from "react";

const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const company: Company = companySchema.parse({ id: id(1), name: "Company 1", status: "active", profile: { legal_name: "Company Inc", description: "", website: "", phone: "", address: "", contact_email: "", business_types: ["rental"] }, version: 3, created_at: "2026-11-08T00:00:00Z" });
const companies = Array.from({ length: 45 }, (_, i) => ({ ...company, id: id(i + 1), name: `Company ${i + 1}` }));
function view(element: ReactNode, url = "/admin/companies") {
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: [url] });
  return render(<RouterProvider router={router} />);
}
const pending = (kind: string, companyID: string | null = null) => managementRequestSchema.parse({ id: id(88), requester_id: id(1), request_key: id(89), kind, company_id: companyID, payload: {}, status: "pending", created_at: "2026-11-08T00:00:00Z", decided_by: null, decided_at: null, decision_reason: "" });

describe("management pages", () => {
  it("renders only the selected member page", () => {
    const members: Member[] = Array.from({ length: 45 }, (_, i) => ({ id: id(i + 10), user_id: id(i + 100), staff_id: id(i + 200), display_name: `Member ${i + 1}`, email: `member${i + 1}@example.com`, role: "staff", revoked_at: null }));
    view(<CompanyMembersPage detail={{ company, members }} candidates={[]} candidatePagination={{ page: 1, page_size: 20, total: 0 }} csrf="csrf" />, `/admin/companies?company=${company.id}&view=members&memberPage=2`);
    expect(screen.queryByRole("link", { name: "Member 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Member 21" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Member 41" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(21);
  });
  it("paginates owned companies and retains the selected company page in detail links", () => {
    view(<MyCompaniesPage companies={companies} />, "/account/requests?view=companies&companyPage=3");
    expect(screen.queryByRole("link", { name: "Company 1" })).not.toBeInTheDocument();
    const selected = screen.getByRole("link", { name: "Company 41" });
    expect(selected).toBeInTheDocument();
    expect(new URL(selected.getAttribute("href")!, "https://app.example").searchParams.get("companyPage")).toBe("3");
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });
  it("paginates companies in user membership details", () => {
    view(<UserDetailPage detail={{ user: { id: id(99), email: "user@example.com", email_verified: true, display_name: "User", account_type: "business", status: "active", version: 1, created_at: "2026-11-08T00:00:00Z" }, companies }} />, `/admin/users?user=${id(99)}&view=detail&companyPage=3`);
    expect(screen.queryByText("Company 1", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("Company 41", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "この企業の所属・プロファイルを管理" })).toHaveLength(5);
  });
  it("blocks each duplicate request using independently loaded pending data", () => {
    view(<>
      <UpgradeRequestPage pending={[pending("business_upgrade")]} csrf="csrf" requestKey={id(90)} user={{ display_name: "User" }} />
      <CompanyCreateRequestPage pending={[pending("company_create")]} csrf="csrf" requestKey={id(91)} />
      <ProfileRequestPage pending={[pending("company_profile_update", company.id)]} company={company} csrf="csrf" requestKey={id(92)} />
    </>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(3);
  });
});
