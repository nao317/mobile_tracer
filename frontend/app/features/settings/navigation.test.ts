import { describe, expect, it } from "vitest";
import type { SessionView } from "../../lib/auth.server";
import { settingsNavigation } from "./navigation";

const t = ((key: string) => key) as never;
const session = {
  user: { id: "10000000-0000-0000-0000-000000000001", email: "staff@example.test", email_verified: true, account_type: "business" as const },
  memberships: [],
  selected_staff_id: "10000000-0000-0000-0000-000000000002",
  system_admin: false,
  csrf_token: "csrf",
} satisfies SessionView;

describe("business navigation", () => {
  it("keeps vehicle and case links on every authenticated layout", () => {
    const groups = settingsNavigation(t, session);
    expect(groups.flatMap(group => group.items.map(item => item.to))).toEqual(expect.arrayContaining([
      "/app", "/app/vehicles", "/app/cases", "/casework", "/casework/inbox", "/transactions", "/history-shares", "/licenses",
    ]));
    expect(groups.find(group => group.id === "cases")?.items.map(item => item.to)).toEqual([
      "/app/cases", "/casework", "/casework/inbox", "/casework/new",
    ]);
    expect(groups.find(group => group.id === "transactions")?.items.map(item => item.to)).toEqual([
      "/app/vehicles", "/transactions", "/history-shares",
    ]);
    expect(groups.some(group => group.id === "vehicles" || group.id === "casework")).toBe(false);
  });

  it("does not expose business links without a selected membership", () => {
    const groups = settingsNavigation(t, { ...session, selected_staff_id: null });
    expect(groups.flatMap(group => group.items.map(item => item.to))).not.toContain("/app/vehicles");
    expect(groups.flatMap(group => group.items.map(item => item.to))).toEqual(expect.arrayContaining(["/casework", "/transactions", "/history-shares"]));
  });

  it("shows case proposal only to business accounts", () => {
    expect(settingsNavigation(t, { ...session, user: { ...session.user, account_type: "business" } }).flatMap(group => group.items.map(item => item.to))).toContain("/casework/new");
    expect(settingsNavigation(t, { ...session, user: { ...session.user, account_type: "general" } }).flatMap(group => group.items.map(item => item.to))).not.toContain("/casework/new");
    expect(settingsNavigation(t, { ...session, selected_staff_id: null }).flatMap(group => group.items.map(item => item.to))).not.toContain("/casework/new");
  });
});
