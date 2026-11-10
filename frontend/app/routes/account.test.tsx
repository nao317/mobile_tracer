import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DisplaySettingsProvider } from "../components/ui/display-settings";
import { demoId } from "../features/workspace/preview-data";
import Account from "./account";
import type { ComponentType } from "react";

const AccountView = Account as ComponentType<{ loaderData: Parameters<typeof Account>[0]["loaderData"]; actionData?: Parameters<typeof Account>[0]["actionData"] }>;

describe("account page order", () => {
  it("places membership selection and workspace before case links", () => {
    const session = {
      user: { id: demoId(1), email: "staff@example.com", email_verified: true, account_type: "business" as const },
      memberships: [{ tenant_id: demoId(2), tenant_name: "Example", staff_id: demoId(3), display_name: "Staff" }],
      selected_staff_id: demoId(3), system_admin: false, csrf_token: "csrf",
    };
    const router = createMemoryRouter([{ path: "/account", element: <DisplaySettingsProvider initialLanguage="ja" initialTheme="light"><AccountView loaderData={{ session, roles: ["staff"] }} /></DisplaySettingsProvider> }], { initialEntries: ["/account"] });
    render(<RouterProvider router={router} />);
    const membership = screen.getByText("業務で利用する所属");
    const workspace = screen.getByRole("link", { name: "業務ワークスペースを開く" });
    const cases = screen.getByRole("link", { name: "案件・報告・依頼" });
    expect(membership.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(workspace.compareDocumentPosition(cases) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
