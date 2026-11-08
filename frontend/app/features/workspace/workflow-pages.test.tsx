import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { DisplaySettingsProvider } from "../../components/ui/display-settings";
import { createI18n } from "../../i18n";
import { WorkspaceProvider } from "./workspace-context";
import { createPreviewData } from "./preview-data";
import { AnswersScreen, DisputesScreen, PhotosScreen, SharingScreen, VerificationScreen } from "./workflow-screens";
import { workflowQuery } from "./workflow-navigation";
import { workflowLabel } from "./workflow-labels";
import type { BusinessCase, CommandResult, WorkspaceData } from "./model";
import type { ComponentType } from "react";

function mount(Component: ComponentType<{ item: BusinessCase }>, query: string, source = createPreviewData(), language: "en" | "ja" = "en") {
  const item = source.cases[0], version = source.versions.find(version => version.case_id === item.id && version.status === "submitted")!;
  const execute = vi.fn<(form: FormData) => CommandResult>(() => ({ code: "preview_saved", message: "saved" }));
  const element = <DisplaySettingsProvider initialLanguage={language} initialTheme="light"><WorkspaceProvider value={{ mode: "preview", base: "/preview", snapshot: source, csrf: "", email: "user@example.com", previewAvailable: true, execute }}><Component item={item} /></WorkspaceProvider></DisplaySettingsProvider>;
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: [`/preview/cases/${item.id}/answers?version=${version.id}&${query}`] });
  return { ...render(<RouterProvider router={router} />), execute, item, version, router };
}
const submitted = (source: WorkspaceData) => source.versions.find(version => version.case_id === source.cases[0].id && version.status === "submitted")!;

describe("workflow query pages", () => {
  it("keeps version and independent list pages when navigating", () => {
    const query = new URLSearchParams("version=selected&disputePage=3&historyPage=2");
    const next = new URLSearchParams(workflowQuery(query, { view: "detail", item: "target" }));
    expect(Object.fromEntries(next)).toEqual({ version: "selected", disputePage: "3", historyPage: "2", view: "detail", item: "target" });
  });
  it("shows the request form independently from answers and history", () => {
    const { container } = mount(AnswersScreen, "view=request");
    expect(container.querySelector('input[name="intent"][value="requestConfirmation"]')).toBeInTheDocument();
    expect(container.querySelector('input[name="intent"][value="answer"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Answers for this version" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Receipt" })).toHaveValue("受領");
  });
  it("localizes answers while preserving the stored action kind and response", () => {
    const { container, execute, version, item } = mount(AnswersScreen, "view=new");
    fireEvent.change(screen.getByLabelText("Respondent name (preview)"), { target: { value: "Respondent" } });
    fireEvent.change(screen.getByLabelText("Confirmation type"), { target: { value: "作業承認" } });
    expect(screen.getByRole("option", { name: "Approved" })).toHaveValue("承認");
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "承認" } });
    fireEvent.submit(container.querySelector("form")!);
    const form = execute.mock.calls[0][0];
    expect(Object.fromEntries(form)).toMatchObject({ intent: "answer", versionId: version.id, caseId: item.id, kind: "作業承認", response: "承認", person: "Respondent" });
    expect(form.get("text")).toContain("Work scope:");
  });
  it("paginates answer history by selected version", () => {
    const source = createPreviewData(), version = submitted(source);
    source.workflow!.answers = Array.from({ length: 45 }, (_, i) => ({ id: `answer-${i}`, versionId: version.id, person: `Respondent ${i + 1}`, kind: "受領", response: "受領", text: `Answer ${i + 1}`, at: "2026-11-08T00:00:00Z" }));
    mount(AnswersScreen, "view=history&answerPage=3", source);
    expect(screen.queryByText("Respondent 1")).not.toBeInTheDocument();
    expect(screen.getByText("Respondent 41")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("paginates disputes and retains the list page in detail links", () => {
    const source = createPreviewData(), version = submitted(source), item = source.cases[0];
    source.workflow!.disputes = Array.from({ length: 45 }, (_, i) => ({ id: `dispute-${i}`, caseId: item.id, versionId: version.id, text: `Dispute ${i + 1}`, status: "受付", history: [] }));
    mount(DisputesScreen, "view=list&disputePage=3", source);
    expect(screen.queryByRole("link", { name: "Dispute 1" })).not.toBeInTheDocument();
    const detail = screen.getByRole("link", { name: "Dispute 41" });
    expect(new URL(detail.getAttribute("href")!, "https://app.example").searchParams.get("disputePage")).toBe("3");
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });
  it("separates dispute detail and paginated history", () => {
    const source = createPreviewData(), version = submitted(source);
    source.workflow!.disputes = [{ id: "selected", caseId: source.cases[0].id, versionId: version.id, text: "Customer question", status: "対応中", history: Array.from({ length: 45 }, (_, i) => `Update ${i + 1}`) }];
    const { container } = mount(DisputesScreen, "view=history&item=selected&historyPage=3", source);
    expect(screen.getByText("Update 41")).toBeInTheDocument();
    expect(screen.queryByText("Update 1")).not.toBeInTheDocument();
    expect(container.querySelector('input[name="intent"][value="advanceDispute"]')).not.toBeInTheDocument();
  });
  it("shows sharing creation separately from photo review and revocation", () => {
    const { container } = mount(SharingScreen, "view=new");
    expect(container.querySelector('input[name="intent"][value="share"]')).toBeInTheDocument();
    expect(container.querySelector('input[name="intent"][value="maskPhoto"]')).not.toBeInTheDocument();
    expect(container.querySelector('input[name="intent"][value="revokeShare"]')).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Condition records and photos (excluding personal information)" })).toHaveValue("状態記録・写真（個人情報を除く）");
  });
  it("paginates photos in sharing review", () => {
    const source = createPreviewData(), version = submitted(source);
    source.workflow!.photos = Array.from({ length: 45 }, (_, i) => ({ id: `photo-${i}`, versionId: version.id, position: "正面", name: `Photo ${i + 1}`, note: `Photo note ${i + 1}`, receivedAt: "2026-11-08T00:00:00Z", status: "saved" }));
    const { container } = mount(SharingScreen, "view=review&photoPage=3", source);
    expect(screen.getByText("Photo note 41")).toBeInTheDocument();
    expect(screen.queryByText("Photo note 1")).not.toBeInTheDocument();
    expect(container.querySelectorAll('input[name="intent"][value="maskPhoto"]')).toHaveLength(5);
  });
  it("restricts revocation forms to the selected share", () => {
    const source = createPreviewData(), version = submitted(source);
    source.workflow!.shares = [{ id: "target", versionId: version.id, recipient: "Selected recipient", expires: "2099-01-01T00:00:00Z", scope: "状態記録・写真（個人情報を除く）", status: "active" }, { id: "other", versionId: version.id, recipient: "Other recipient", expires: "2099-01-01T00:00:00Z", scope: "", status: "active" }];
    const { container } = mount(SharingScreen, "view=revoke&item=target", source);
    expect(screen.getByText("Selected recipient")).toBeInTheDocument();
    expect(screen.queryByText("Other recipient")).not.toBeInTheDocument();
    expect(container.querySelector('input[name="shareId"]')).toHaveValue("target");
  });
  it("paginates verification history without showing operation forms", () => {
    const source = createPreviewData(), version = submitted(source);
    source.workflow!.audit = Array.from({ length: 45 }, (_, i) => ({ id: `audit-${i}`, at: "2026-11-08T00:00:00Z", actor: "Staff", action: `Operation ${i + 1}`, target: version.id }));
    const { container } = mount(VerificationScreen, "view=history&historyPage=3", source);
    expect(screen.getByText(/Operation 41/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(container.querySelector("form")).not.toBeInTheDocument();
  });
  it("keeps photo operations off the overview and submitted versions immutable", () => {
    const source = createPreviewData(), recordId = source.versions.find(version => version.case_id === source.cases[0].id && version.status === "draft")!.record_id;
    const PhotoPage = ({ item }: { item: BusinessCase }) => <PhotosScreen item={item} recordId={recordId} />;
    const { container } = mount(PhotoPage, "view=overview", source);
    expect(container.querySelector('input[name="intent"][value="photo"]')).not.toBeInTheDocument();
  });
  it("maps stored workflow labels and preserves user content", () => {
    const { t } = createI18n("en");
    expect(workflowLabel(t, "受領")).toBe("Receipt");
    expect(workflowLabel(t, "検証不能")).toBe("Cannot verify");
    expect(workflowLabel(t, "Customer supplied content")).toBe("Customer supplied content");
  });
});
