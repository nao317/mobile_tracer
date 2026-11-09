import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DisplaySettingsProvider } from "../../components/ui/display-settings";
import { createPreviewData } from "../workspace/preview-data";
import { EventTimelinePage } from "./event-timeline-page";
import { StartPage } from "./start-page";
import { type Casework } from "./model";
const now = Date.parse("2026-11-09T10:00:00Z");
function sample(): Casework {
  const p = createPreviewData();
  return {
    case: { ...p.cases[0], status: "in_progress" },
    vehicle: p.vehicles[0],
    start: {
      id: "start",
      case_id: p.cases[0].id,
      version_no: 1,
      customer_id: "customer",
      actor_id: "staff",
      terms_hash: "hash",
      deadline: "2030-11-09T10:00:00Z",
      created_at: "2026-11-09T00:00:00Z",
      decision: "approved",
      responded_at: "2026-11-09T01:00:00Z",
    },
    terms: {
      schema: "v1",
      case: p.cases[0],
      vehicle: p.vehicles[0],
      terms: "車両と貸出条件",
      customer_id: "customer",
      actor_id: "staff",
      deadline: "2030-11-09T10:00:00Z",
      company_name: "取引先企業",
      store_name: "担当店舗",
    },
    can_manage: true,
    api_configured: false,
    next_stages: ["inspection"],
    registrations: [],
    events: [
      {
        event: {
          id: "event",
          case_id: p.cases[0].id,
          actor_id: "staff",
          origin: "business",
          kind: "work",
          title: "見積作業",
          description: "対象の範囲",
          amount_minor: 1000,
          target_stage: null,
          deadline: "2030-11-09T10:00:00Z",
          supersedes_id: null,
          parent_event_id: null,
          created_at: "2026-11-09T00:00:00Z",
        },
        state: "pending",
        actions: [],
        superseded: false,
      },
    ],
  };
}
function show(item: Casework, userID: string, start = false) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <DisplaySettingsProvider initialLanguage="ja" initialTheme="light">
          {start ? (
            <StartPage
              item={item}
              csrf="csrf"
              requestKey="key"
              userID={userID}
              now={now}
            />
          ) : (
            <EventTimelinePage
              item={item}
              csrf="csrf"
              requestKey="key"
              userID={userID}
              now={now}
            />
          )}
        </DisplaySettingsProvider>
      ),
    },
  ]);
  render(<RouterProvider router={router} />);
}
describe("casework permissions and execution", () => {
  it("prevents business from executing an unapproved work item", () => {
    show(sample(), "staff");
    expect(
      screen.queryByRole("button", { name: "承認済みの範囲に着手する" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "相手への回答を保存する" }),
    ).not.toBeInTheDocument();
  });
  it("allows the named customer to review a work proposal", () => {
    const item = sample();
    item.can_manage = false;
    show(item, "customer");
    expect(
      screen.getByRole("button", { name: "相手への回答を保存する" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "承認済みの範囲に着手する" }),
    ).not.toBeInTheDocument();
  });
  it("allows business execution only after customer approval", () => {
    const item = sample();
    item.events[0].state = "approved";
    show(item, "staff");
    expect(
      screen.getByRole("button", { name: "承認済みの範囲に着手する" }),
    ).toBeInTheDocument();
  });
  it("offers customer incident entry only on an active case", () => {
    const item = sample();
    item.case.status = "awaiting_customer";
    item.can_manage = false;
    item.events = [];
    show(item, "customer");
    expect(
      screen.queryByRole("link", { name: "インシデントを報告" }),
    ).not.toBeInTheDocument();
  });
  it("shows the counterpart and only the customer's start approval", () => {
    const item = sample();
    item.case.status = "awaiting_customer";
    item.start.decision = null;
    item.can_manage = false;
    show(item, "customer", true);
    expect(screen.getByText(/取引先企業/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "案件開始への回答を保存する" }),
    ).toBeInTheDocument();
  });
});
