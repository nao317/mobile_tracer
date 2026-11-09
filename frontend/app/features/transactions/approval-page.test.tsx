import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DisplaySettingsProvider } from "../../components/ui/display-settings";
import { ApprovalPage } from "./approval-page";
import { createPreviewData } from "../workspace/preview-data";
import type { Transaction } from "./model";
const now = Date.parse("2026-11-09T10:00:00Z");
function show(
  userID: string,
  decision: string | null = null,
  deadline = "2026-11-10T10:00:00Z",
) {
  const snapshot = createPreviewData();
  const item: Transaction = {
 api_configured:false,
    content: {
      schema: "v1",
      presented_at: null,
      version: snapshot.versions[0],
      case: snapshot.cases[0],
      vehicle: snapshot.vehicles[0],
      media: [],
    },
    requests: [
      {
        id: "request-id",
        version_id: snapshot.versions[0].id,
        user_id: "customer",
        qualification: "owner",
        kind: "state_agreement",
        statement: "この写真の車両状態を承認します",
        deadline,
        decision,
        responded_at: decision ? "2026-11-09T09:00:00Z" : null,
      },
    ],
    anchor: null,
    can_manage: false,
  };
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <DisplaySettingsProvider initialLanguage="ja" initialTheme="light">
          <ApprovalPage item={item} csrf="csrf" userID={userID} now={now} />
        </DisplaySettingsProvider>
      ),
    },
  ]);
  render(<RouterProvider router={router} />);
}
describe("customer approval", () => {
  it("shows a response form only to the named customer", () => {
    show("customer");
    expect(screen.getByRole("combobox", { name: "回答" })).toBeInTheDocument();
    expect(
      screen.getByText("この写真の車両状態を承認します"),
    ).toBeInTheDocument();
  });
  it("does not let the business answer for the customer", () => {
    show("staff");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
  it("does not offer approval after the deadline", () => {
    show("customer", null, "2026-11-08T10:00:00Z");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(/回答：期限超過/)).toBeInTheDocument();
  });
  it("preserves a rejection without showing an overwrite form", () => {
    show("customer", "rejected");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(/回答：拒否/)).toBeInTheDocument();
  });
});
