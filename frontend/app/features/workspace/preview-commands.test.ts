// @vitest-environment node
import { describe, expect, it } from "vitest";
import { executePreview } from "./preview-commands";
import { createPreviewData, demoId } from "./preview-data";

const initial = createPreviewData();
const item = initial.cases[0];
const submitted = initial.versions.find((v) => v.case_id === item.id && v.status === "submitted")!;
const draft = initial.versions.find((v) => v.case_id === item.id && v.status === "draft")!;
const draftIds = { caseId: item.id, recordId: draft.record_id, versionId: draft.id };
const submittedIds = { caseId: item.id, recordId: submitted.record_id, versionId: submitted.id };
function form(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("preview result codes", () => {
  it.each<{ code: string; values: Record<string, string> }>([
    { code: "unsupported_operation", values: { intent: "unknown" } },
    { code: "vehicle_not_found", values: { intent: "updateVehicle", vehicleId: demoId(999) } },
    { code: "duplicate_identifier", values: { intent: "createVehicle", identifier: initial.vehicles[0].identifiers[0].value } },
    { code: "vehicle_input_too_long", values: { intent: "createVehicle", model_name: "x".repeat(201) } },
    { code: "business_type_required", values: { intent: "createCase" } },
    { code: "case_selection_required", values: { intent: "createCase", case_type: "rental" } },
    { code: "case_not_found", values: { intent: "createRecord" } },
    { code: "invalid_record_kind", values: { intent: "createRecord", caseId: item.id, record_kind: "unknown" } },
    { code: "version_conflict", values: { intent: "updateDraft", ...draftIds, lock_version: "99" } },
    { code: "invalid_transition", values: { intent: "updateCase", caseId: item.id, stage: "unknown" } },
    { code: "cancellation_reason_required", values: { intent: "cancelCase", caseId: item.id } },
    { code: "version_not_editable", values: { intent: "submitRecord", ...submittedIds } },
    { code: "correction_reason_required", values: { intent: "correctRecord", ...submittedIds } },
    { code: "submitted_photo_immutable", values: { intent: "photo", ...submittedIds } },
    { code: "photo_exception_approval_required", values: { intent: "photo", ...draftIds, exception: "1" } },
    { code: "invalid_photo", values: { intent: "photo", ...draftIds } },
    { code: "submitted_version_required", values: { intent: "answer", ...draftIds } },
    { code: "invalid_answer", values: { intent: "answer", ...submittedIds } },
    { code: "dispute_text_required", values: { intent: "newDispute", ...submittedIds } },
    { code: "dispute_action_required", values: { intent: "advanceDispute" } },
    { code: "photo_not_found", values: { intent: "maskPhoto", ...submittedIds, photoId: demoId(999) } },
    { code: "invalid_share", values: { intent: "share", ...submittedIds, recipient: "Sample", expires: "2020-01-01" } },
    { code: "share_not_found", values: { intent: "revokeShare", shareId: demoId(999) } },
    { code: "identifier_required", values: { intent: "updateIdentifier" } },
    { code: "merge_reason_required", values: { intent: "mergeVehicle" } },
    { code: "configuration_input_required", values: { intent: "previewConfiguration" } },
    { code: "configuration_trial_required", values: { intent: "applyConfiguration" } },
    { code: "management_name_required", values: { intent: "manage" } },
    { code: "last_admin_required", values: { intent: "manage", managementId: demoId(2), status: "停止" } },
  ])("exposes $code without mutating a rejected command", ({ code, values }) => {
    const source = createPreviewData();
    const before = structuredClone(source);
    const outcome = executePreview(source, form(values));
    expect(outcome.result.code).toBe(code);
    expect(outcome.result.error).toEqual(expect.any(String));
    expect(outcome.result.message).toBeUndefined();
    expect(outcome.snapshot).toBe(source);
    expect(source).toEqual(before);
  });

  it("keeps field errors while exposing validation_error", () => {
    const outcome = executePreview(createPreviewData(), form({
      intent: "updateDraft", ...draftIds, lock_version: String(draft.lock_version),
      "entry:odometer": "-1",
    }));
    expect(outcome.result).toMatchObject({
      code: "validation_error", error: "入力内容を確認してください。",
      fields: { "entry:odometer": ["数値の形式と範囲を確認してください。"] },
    });
  });

  it.each([
    ["manage", "forbidden"],
    ["createVehicle", "vehicle_admin_required"],
    ["createCase", "forbidden"],
  ])("retains the permission gate for %s", (intent, code) => {
    const source = createPreviewData();
    source.context.principal.roles = [{ role: "auditor", store_id: null }];
    expect(executePreview(source, form({ intent })).result.code).toBe(code);
  });

  it("retains the completed-case lock and returns case_not_writable", () => {
    const source = createPreviewData();
    source.cases[0].status = "completed";
    const outcome = executePreview(source, form({ intent: "updateCase", caseId: item.id, stage: "inspection" }));
    expect(outcome.result.code).toBe("case_not_writable");
    expect(outcome.snapshot).toBe(source);
  });

  it("distinguishes missing required entries from incomplete photos", () => {
    const source = createPreviewData();
    const editable = source.versions.find((v) => v.id === draft.id)!;
    delete editable.entries.odometer;
    const command = form({ intent: "submitRecord", ...draftIds });
    expect(executePreview(source, command).result.code).toBe("required_fields_missing");
    editable.entries.odometer = 0;
    source.workflow!.photos = [];
    expect(executePreview(source, command).result.code).toBe("photos_incomplete");
  });

  it("preserves work approval and support self-approval restrictions", () => {
    const source = createPreviewData();
    const repair = source.cases.find((c) => c.case_type === "repair")!;
    repair.stage = "estimate";
    expect(executePreview(source, form({ intent: "updateCase", caseId: repair.id, stage: "work" })).result.code).toBe("work_approval_required");
    const support = source.workflow!.management.find((m) => m.kind === "support")!;
    expect(executePreview(source, form({ intent: "manage", managementId: support.id, status: "自己承認" })).result.code).toBe("support_self_approval_forbidden");
  });

  it("adds preview_saved while preserving success messages, redirects and persisted draft values", () => {
    const source = createPreviewData();
    const before = structuredClone(source);
    const outcome = executePreview(source, form({ intent: "correctRecord", ...submittedIds, reason: "燃料値の訂正" }));
    expect(outcome.result).toMatchObject({
      code: "preview_saved",
      message: "プレビューに反映しました。実データの保存・通知・外部登録は行っていません。",
      redirectTo: expect.stringMatching(/\/edit\?version=/),
    });
    const correction = outcome.snapshot.versions.find((v) => v.based_on_version_id === submitted.id)!;
    expect(correction).toMatchObject({ status: "draft", change_reason: "燃料値の訂正", entries: submitted.entries });
    expect(outcome.snapshot.workflow!.audit[0]).toMatchObject({ actor: "サンプル担当者", action: "correctRecord" });
    expect(source).toEqual(before);
  });
});
