import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DisplaySettingsProvider } from "../../../components/ui/display-settings";
import { createTranslator } from "../../../i18n";
import { createPreviewData, demoId } from "../preview-data";
import { WorkspaceProvider } from "../workspace-context";
import { resolveScreen, workspaceNavigation } from "../screens";
import type { WorkspaceData } from "../model";
import { CaseScreen } from "./case-overview";
import { CaseManageScreen } from "./case-manage";
import { RecordScreen } from "./record";
import { RecordHistoryScreen } from "./record-history";
import { VehicleScreen } from "./vehicle";
import { CaseParticipantsScreen } from "./case-participants";

function show(children: ReactNode, snapshot: WorkspaceData, path: string, mode: "live" | "preview" = "preview") {
  const router = createMemoryRouter([{
    path: "*", element:
      <DisplaySettingsProvider initialLanguage="en" initialTheme="light">
        <WorkspaceProvider value={{ snapshot, base: mode === "live" ? "/app" : "/preview", mode, csrf: "csrf", email: "staff@example.test", previewAvailable: true, execute: vi.fn(() => ({ message: "saved" })) }}>{children}</WorkspaceProvider>
      </DisplaySettingsProvider>,
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("workspace route registry", () => {
  it.each([
    ["cases/case-id", "case"],
    ["cases/case-id/records", "case-records"],
    ["cases/case-id/participants", "case-participants"],
    ["cases/case-id/manage", "case-manage"],
    ["cases/case-id/records/record-id", "record"],
    ["cases/case-id/records/record-id/history", "record-history"],
    ["cases/case-id/records/new", "record-new"],
  ])("resolves %s to its own page", (path, key) => {
    expect(resolveScreen(path)?.key).toBe(key);
  });

  it("omits preview workflows and unauthorized writes from live navigation", () => {
    const { context } = createPreviewData();
    context.principal.roles = [{ role: "auditor", store_id: null }];
    const groups = workspaceNavigation({ base: "/app", mode: "live", context, caseId: "case-id", recordId: "record-id" }, createTranslator("en"));
    const links = groups.flatMap(group => group.items);
    expect(groups.some(group => group.id === "vehicles")).toBe(false);
    expect(groups.find(group => group.id === "transactions")?.items.map(item => item.id)).toContain("vehicles");
    expect(links.map(link => link.id)).toEqual(expect.arrayContaining(["case-records", "record", "record-history"]));
    expect(links.map(link => link.id)).not.toEqual(expect.arrayContaining(["case-new"]));
    for (const id of ["vehicle-new", "case-new", "case-manage", "record-edit", "photos", "submit", "correct", "case-participants", "configuration"])
      expect(links.some(link => link.id === id)).toBe(false);
    expect(links.find(link => link.id === "record-history")?.to).toBe("/app/cases/case-id/records/record-id/history");
  });
});

describe("separate core workspace pages", () => {
  it("keeps case overview separate from records and management forms", () => {
    const snapshot = createPreviewData(), item = snapshot.cases[0];
    show(<CaseScreen item={item} />, snapshot, `/preview/cases/${item.id}`);
    expect(screen.getByRole("heading", { name: "Case progress" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change stage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Records" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Participants" })).not.toBeInTheDocument();
  });

  it("links a case awaiting the customer's start approval to the casework screen", () => {
    const snapshot = createPreviewData(), item = { ...snapshot.cases[0], status: "awaiting_customer" as const };
    show(<CaseScreen item={item} />, snapshot, `/app/cases/${item.id}`, "live");
    expect(screen.getByRole("link", { name: "開始条件・承認を開く" })).toHaveAttribute("href", `/casework/${item.id}/start`);
  });

  it("retains stage, assignment, cancellation and completion actions on management", () => {
    const snapshot = createPreviewData(), item = snapshot.cases[0];
    show(<CaseManageScreen item={item} />, snapshot, `/preview/cases/${item.id}/manage`);
    expect(document.querySelector('input[name="intent"][value="assignCase"]')).toBeInTheDocument();
    expect(document.querySelector('input[name="intent"][value="updateCase"]')).toBeInTheDocument();
    expect(document.querySelector('input[name="intent"][value="cancelCase"]')).toBeInTheDocument();
    expect(document.querySelector('input[name="intent"][value="completeCase"]')).toBeInTheDocument();
  });

  it("omits unavailable live photo, submit and correction actions on submitted records", () => {
    const snapshot = createPreviewData(), item = snapshot.cases[0];
    const version = snapshot.versions.find(version => version.case_id === item.id && version.status === "submitted")!;
    snapshot.selectedVersion = version;
    snapshot.workflow = null;
    show(<RecordScreen item={item} recordId={version.record_id} />, snapshot, `/app/cases/${item.id}/records/${version.record_id}`, "live");
    expect(screen.getByRole("heading", { name: "Record content" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Photos and submission" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Correction or addition" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Version history" })).not.toBeInTheDocument();
  });

  it("keeps live draft editing", () => {
    const snapshot = createPreviewData(), item = snapshot.cases[0];
    const version = { ...snapshot.versions.find(version => version.case_id === item.id)!, status: "draft" as const };
    snapshot.selectedVersion = version;
    snapshot.workflow = null;
    show(<RecordScreen item={item} recordId={version.record_id} />, snapshot, `/app/cases/${item.id}/records/${version.record_id}`, "live");
    expect(screen.getByRole("link", { name: "Edit draft" })).toHaveAttribute("href", expect.stringContaining("/edit?version="));
  });

  it("rejects a selected version belonging to a different record", () => {
    const snapshot = createPreviewData(), item = snapshot.cases[0];
    const version = snapshot.versions.find(version => version.case_id === item.id)!;
    snapshot.selectedVersion = version;
    show(<RecordScreen item={item} recordId={demoId(999)} />, snapshot, `/preview/cases/${item.id}/records/${demoId(999)}`);
    expect(screen.getByRole("heading", { name: "Record version not found" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Record content" })).not.toBeInTheDocument();
  });

  it("preserves the version-history page when opening a version", () => {
    const snapshot = createPreviewData(), item = snapshot.cases[0];
    const version = snapshot.versions.find(version => version.case_id === item.id)!;
    snapshot.versions = Array.from({ length: 21 }, (_, index) => ({ ...version, id: demoId(300 + index), version_no: index + 1 }));
    const path = `/preview/cases/${item.id}/records/${version.record_id}/history?historyPage=2`;
    show(<RecordHistoryScreen item={item} recordId={version.record_id} />, snapshot, path);
    const link = screen.getByRole("link", { name: /v1/ });
    expect(new URL(link.getAttribute("href")!, "https://example.test").searchParams.get("returnTo")).toBe(path);
    expect(screen.queryByRole("heading", { name: "Record content" })).not.toBeInTheDocument();
  });

  it("localizes persisted preview answer and verification states", () => {
    const snapshot = createPreviewData(), item = snapshot.cases[0];
    const version = snapshot.versions.find(version => version.case_id === item.id && version.status === "submitted")!;
    snapshot.selectedVersion = version;
    snapshot.workflow!.answers = [{ ...snapshot.workflow!.answers[0], versionId: version.id, kind: "受領", response: "拒否" }];
    snapshot.workflow!.registration[version.id] = "失敗";
    snapshot.workflow!.verification[version.id] = "不一致";
    show(<RecordScreen item={item} recordId={version.record_id} />, snapshot, `/preview/cases/${item.id}/records/${version.record_id}`);
    expect(screen.getByText("Receipt: Refused")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Mismatch")).toBeInTheDocument();
    expect(screen.queryByText("受領：拒否")).not.toBeInTheDocument();
  });

  it("paginates participants without embedding the create form", () => {
    const snapshot = createPreviewData(), item = snapshot.cases[0];
    snapshot.workflow!.management = Array.from({ length: 21 }, (_, index) => ({
      id: demoId(500 + index), kind: `participant:${item.id}`, name: `Participant ${index + 1}`, detail: "Owner", status: "有効", history: [],
    }));
    const path = `/preview/cases/${item.id}/participants?participantsPage=2`;
    show(<CaseParticipantsScreen item={item} />, snapshot, path);
    expect(screen.getByText("Participant 21")).toBeInTheDocument();
    expect(screen.queryByText("Participant 1")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Participant name" })).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Add participant" });
    const url = new URL(link.getAttribute("href")!, "https://example.test");
    expect(url.searchParams.get("view")).toBe("new");
    expect(url.searchParams.get("returnTo")).toBe(path);
  });

  it("renders participant creation as a separate URL view", () => {
    const snapshot = createPreviewData(), item = snapshot.cases[0];
    show(<CaseParticipantsScreen item={item} />, snapshot, `/preview/cases/${item.id}/participants?view=new`);
    expect(screen.getByRole("textbox", { name: "Participant name" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add participant" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });

  it("shows vehicle details without editing fields or unconnected live history", () => {
    const snapshot = createPreviewData(), vehicle = snapshot.vehicles[0];
    snapshot.workflow = null;
    vehicle.identifiers.push({ ...vehicle.identifiers[0], id: demoId(777), value: "EXPIRED-IDENTIFIER", valid_to: "2020-01-01T00:00:00Z" });
    show(<VehicleScreen vehicleId={vehicle.id} />, snapshot, `/app/vehicles/${vehicle.id}?relatedPage=2`, "live");
    expect(screen.getByText(vehicle.model_name!, { selector: "dd" })).toBeInTheDocument();
    expect(screen.queryByText("EXPIRED-IDENTIFIER")).not.toBeInTheDocument();
    expect(screen.getByText(vehicle.id, { selector: "code" }).closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("textbox", { name: "Vehicle model" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Identifier and ownership history" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change vehicle model" })).toHaveAttribute("href", expect.stringContaining("?view=edit"));
  });

  it("renders vehicle editing on its own URL and returns to the filtered detail", () => {
    const snapshot = createPreviewData(), vehicle = snapshot.vehicles[0];
    const detail = `/app/vehicles/${vehicle.id}?relatedPage=2`;
    show(<VehicleScreen vehicleId={vehicle.id} />, snapshot, `/app/vehicles/${vehicle.id}?view=edit&returnTo=${encodeURIComponent(detail)}`, "live");
    expect(screen.getByRole("textbox", { name: "Vehicle model" })).toHaveValue(vehicle.model_name);
    expect(screen.queryByRole("heading", { name: "Cases for this vehicle" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to vehicles" })).toHaveAttribute("href", detail);
  });
});
