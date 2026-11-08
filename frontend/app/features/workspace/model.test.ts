// @vitest-environment node
import { describe, expect, it } from "vitest";
import { entriesFromForm, rulesFor } from "./model";
import { createPreviewData, demoCaseIds, demoId } from "./preview-data";
import { executePreview } from "./preview-commands";

function form(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}
describe("draft entries", () => {
  it("preserves untouched fields and distinguishes false, zero, null and explicit removal", () => {
    const rules = {
      odometer: { type: "integer" as const },
      inspected: { type: "boolean" as const },
      notes: { type: "string" as const, nullable: true },
      other: { type: "string" as const },
    };
    const result = entriesFromForm(
      form({
        "entry:odometer": "0",
        "entry:inspected": "false",
        "null:notes": "1",
      }),
      rules,
      { notes: "old", other: "keep" },
    );
    expect(result.entries).toEqual({
      odometer: 0,
      inspected: false,
      notes: null,
      other: "keep",
    });
    expect(
      entriesFromForm(form({ "remove:other": "1" }), rules, result.entries)
        .entries,
    ).not.toHaveProperty("other");
  });
  it("allows missing submission requirements in drafts but rejects unsafe integers and invalid types", () => {
    const rules = {
      distance: { type: "integer" as const, required: true, minimum: 0 },
      checked: { type: "boolean" as const },
    };
    expect(entriesFromForm(new FormData(), rules).fields).toEqual({});
    for (const value of ["9007199254740992", "1e3", "1.5", "-1", " "])
      expect(
        entriesFromForm(form({ "entry:distance": value }), rules).fields,
      ).toHaveProperty("entry:distance");
    expect(
      entriesFromForm(form({ "entry:checked": "yes" }), rules).fields,
    ).toHaveProperty("entry:checked");
  });
});
describe("preview workflow invariants", () => {
  it("does not overwrite a stale draft or mutate the source snapshot", () => {
    const initial = createPreviewData(),
      version = initial.versions.find((v) => v.status === "draft")!;
    const outcome = executePreview(
      initial,
      form({
        intent: "updateDraft",
        caseId: version.case_id,
        recordId: version.record_id,
        versionId: version.id,
        lock_version: "99",
        "entry:odometer": "22",
      }),
    );
    expect(outcome.result.error).toContain("別の更新");
    expect(
      initial.versions.find((v) => v.id === version.id)?.entries.odometer,
    ).toBe(12150);
  });
  it("preserves submitted content and keeps old answers off the corrected version", () => {
    const initial = createPreviewData(),
      version = initial.versions[0];
    const corrected = executePreview(
      initial,
      form({
        intent: "correctRecord",
        caseId: version.case_id,
        recordId: version.record_id,
        versionId: version.id,
        reason: "燃料値の訂正",
      }),
    );
    expect(corrected.result.error).toBeUndefined();
    const draft = corrected.snapshot.versions.find(
      (v) => v.based_on_version_id === version.id,
    )!;
    expect(draft.status).toBe("draft");
    expect(draft.version_no).toBe(2);
    expect(
      corrected.snapshot.workflow!.answers.filter(
        (a) => a.versionId === draft.id,
      ),
    ).toEqual([]);
    expect(
      corrected.snapshot.versions.find((v) => v.id === version.id),
    ).toEqual(version);
    expect(initial.versions).toHaveLength(6);
  });
  it("blocks submission when mandatory fields or photos are missing", () => {
    const initial = createPreviewData(),
      version = initial.versions.find((v) => v.status === "draft")!;
    delete version.entries.odometer;
    const values = {
      intent: "submitRecord",
      caseId: version.case_id,
      recordId: version.record_id,
      versionId: version.id,
    };
    expect(executePreview(initial, form(values)).result.error).toContain(
      "必須項目",
    );
    version.entries.odometer = 0;
    initial.workflow!.photos = [];
    expect(executePreview(initial, form(values)).result.error).toContain(
      "撮影箇所",
    );
  });
  it("requires approval of the latest repair scope before advancing to work", () => {
    const initial = createPreviewData(),
      item = initial.cases.find((c) => c.case_type === "repair")!;
    item.stage = "estimate";
    expect(
      executePreview(
        initial,
        form({ intent: "updateCase", caseId: item.id, stage: "work" }),
      ).result.error,
    ).toContain("作業承認");
  });
  it("retains records and receipts when a share is revoked", () => {
    const initial = createPreviewData(),
      share = initial.workflow!.shares[0];
    const outcome = executePreview(
      initial,
      form({ intent: "revokeShare", shareId: share.id }),
    );
    expect(outcome.snapshot.workflow!.shares[0].status).toBe("revoked");
    expect(outcome.snapshot.versions).toEqual(initial.versions);
    expect(outcome.snapshot.workflow!.answers).toEqual(
      initial.workflow!.answers,
    );
  });
  it("retains each case's configuration when applying a new version", () => {
    const initial = createPreviewData(),
      item = initial.cases[0];
    const trial = executePreview(
      initial,
      form({
        intent: "previewConfiguration",
        name: "走行距離を任意に",
        business: "rental",
        reason: "試行",
      }),
    );
    const config = trial.snapshot.workflow!.management.find(
      (m) => m.kind === "configuration",
    )!;
    const applied = executePreview(
      trial.snapshot,
      form({ intent: "applyConfiguration", managementId: config.id }),
    );
    expect(applied.snapshot.context.configuration?.id).not.toBe(
      item.configuration_version_id,
    );
    expect(
      rulesFor(applied.snapshot, item)?.record_kinds.inspection.fields.odometer
        .required,
    ).toBe(true);
    expect(
      applied.snapshot.context.configuration?.settings.businesses.rental
        .record_kinds.inspection.fields.odometer.required,
    ).toBe(false);
  });
  it("protects the last administrator and rejects auditor mutations", () => {
    const initial = createPreviewData();
    expect(
      executePreview(
        initial,
        form({ intent: "manage", managementId: demoId(2), status: "停止" }),
      ).result.error,
    ).toContain("最後の企業管理者");
    initial.context.principal.roles = [{ role: "auditor", store_id: null }];
    expect(
      executePreview(
        initial,
        form({
          intent: "createCase",
          case_type: "rental",
          store_id: demoId(4),
          vehicle_id: demoId(11),
        }),
      ).result.error,
    ).toContain("権限");
  });
  it("keeps unresolved disputes and failed registrations visible after business completion", () => {
    const initial = createPreviewData();
    const complete = executePreview(
      initial,
      form({ intent: "completeCase", caseId: demoCaseIds[0] }),
    );
    expect(complete.snapshot.cases[0].status).toBe("completed");
    expect(complete.snapshot.workflow!.disputes[0].status).toBe("対応中");
    expect(complete.snapshot.workflow!.registration[demoId(41)]).toBe("失敗");
  });
});
