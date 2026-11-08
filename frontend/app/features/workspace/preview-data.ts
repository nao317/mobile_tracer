import type { BusinessType, WorkspaceData } from "./model";

export const demoId = (n: number) =>
  `10000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
export const demoCaseIds = [demoId(21), demoId(22), demoId(23)];
export const photoPositions: Record<BusinessType, string[]> = {
  rental: ["正面", "右前", "右後", "後面", "左後", "左前"],
  dealer: ["正面", "右前", "右側面", "右後", "後面", "左後", "左側面", "左前"],
  repair: ["正面", "右前", "右後", "後面", "左後", "左前"],
};
const created = "2026-11-07T01:00:00Z";
export function createPreviewData(): WorkspaceData {
  const types: BusinessType[] = ["rental", "dealer", "repair"];
  const staffId = demoId(2),
    configurationId = demoId(3),
    storeId = demoId(4);
  const businesses = Object.fromEntries(
    types.map((type) => {
      const stages =
        type === "rental"
          ? ["intake", "inspection", "checkout", "returned"]
          : type === "dealer"
            ? ["intake", "preparation", "delivery"]
            : ["intake", "estimate", "work", "handover"];
      return [
        type,
        {
          stages,
          transitions: Object.fromEntries(
            stages.map((s, i) => [s, stages[i + 1] ? [stages[i + 1]] : []]),
          ),
          record_kinds: {
            inspection: {
              fields: {
                odometer: {
                  type: "integer" as const,
                  minimum: 0,
                  maximum: 1000000000,
                  required: true,
                },
                fuel_level: {
                  type: "number" as const,
                  minimum: 0,
                  maximum: 100,
                },
                notes: {
                  type: "string" as const,
                  max_length: 2000,
                  nullable: true,
                },
                inspected: { type: "boolean" as const },
                ...(type === "repair"
                  ? {
                      estimate: {
                        type: "integer" as const,
                        minimum: 0,
                        required: true,
                      },
                      work_scope: {
                        type: "string" as const,
                        max_length: 2000,
                        required: true,
                      },
                    }
                  : {}),
              },
            },
          },
        },
      ];
    }),
  );
  return {
    asOf: new Date().toISOString(),
    context: {
      principal: {
        tenant_id: demoId(1),
        staff_id: staffId,
        roles: [{ role: "tenant_admin", store_id: null }],
      },
      stores: [
        { id: storeId, name: "サンプル中央店" },
        { id: demoId(5), name: "サンプル西店" },
      ],
      configuration: {
        id: configurationId,
        settings: { schema_version: 1, businesses },
      },
    },
    vehicles: ["コンパクトカー", "セダン", "ミニバン"].map((name, i) => ({
      id: demoId(11 + i),
      model_name: name,
      created_at: created,
      identifiers: [
        {
          id: demoId(101 + i),
          kind: "plate_number",
          value: `サンプル ${i + 1}号`,
          valid_from: created,
          valid_to: null,
          verified_at: null,
        },
      ],
    })),
    cases: types.map((type, i) => ({
      id: demoCaseIds[i],
      store_id: storeId,
      vehicle_id: demoId(11 + i),
      case_type: type,
      configuration_version_id: configurationId,
      assignee_id: staffId,
      stage: "intake",
      status: "in_progress",
      created_by: staffId,
      created_at: created,
    })),
    records: types.flatMap((_, i) =>
      [0, 1].map((j) => ({
        id: demoId(31 + i * 2 + j),
        case_id: demoCaseIds[i],
        record_kind: "inspection",
        created_by: staffId,
        created_at: created,
      })),
    ),
    versions: types.flatMap((type, i) =>
      [0, 1].map((j) => ({
        id: demoId(41 + i * 2 + j),
        record_id: demoId(31 + i * 2 + j),
        case_id: demoCaseIds[i],
        version_no: 1,
        status: j === 0 ? ("submitted" as const) : ("draft" as const),
        configuration_version_id: configurationId,
        lock_version: 0,
        based_on_version_id: null,
        change_reason: null,
        submitted_at: j === 0 ? created : null,
        created_at: created,
        entries: {
          odometer: 12000 + j * 150,
          fuel_level: 80 - j * 20,
          notes:
            j === 0
              ? "受付時の状態。左前に既存の擦り傷あり。"
              : "引き渡し前の点検。左前の傷は受付時と同じ。",
          inspected: true,
          ...(type === "repair"
            ? { estimate: 22000, work_scope: "左前バンパーの補修" }
            : {}),
        },
      })),
    ),
    workflow: {
      photos: types.flatMap((type, i) =>
        [0, 1].flatMap((j) =>
          photoPositions[type].map((position, k) => ({
            id: demoId(1000 + i * 100 + j * 20 + k),
            versionId: demoId(41 + i * 2 + j),
            position,
            name: `${position}・サンプル画像`,
            status: "saved" as const,
            note: position === "左前" ? "既存の擦り傷" : "目立つ損傷なし",
            receivedAt: created,
          })),
        ),
      ),
      answers: [
        {
          id: demoId(71),
          versionId: demoId(41),
          person: "サンプル利用者",
          kind: "受領",
          response: "受領",
          text: "受付時の状態記録を受領しました。状態への同意とは別の回答です。",
          at: created,
        },
      ],
      disputes: [
        {
          id: demoId(81),
          caseId: demoCaseIds[0],
          versionId: demoId(41),
          text: "左前の傷について撮影箇所を再確認したい。",
          status: "対応中",
          history: ["受付：サンプル利用者", "担当者が原本を確認中"],
        },
      ],
      shares: [
        {
          id: demoId(91),
          versionId: demoId(41),
          recipient: "サンプル利用者",
          expires: "2099-12-31T23:59:59+09:00",
          scope: "状態記録・写真（個人情報を除く）",
          status: "active",
        },
      ],
      registration: Object.fromEntries(
        [41, 43, 45].map((n) => [demoId(n), n === 41 ? "失敗" : "登録待ち"]),
      ),
      verification: {},
      audit: [
        {
          id: demoId(61),
          at: created,
          actor: "サンプル担当者",
          action: "受付時の記録を提出",
          target: "受付記録 v1",
        },
      ],
      management: [
        {
          id: storeId,
          kind: "store",
          name: "サンプル中央店",
          detail: "貸出・販売・修理",
          status: "有効",
          history: [],
        },
        {
          id: staffId,
          kind: "staff",
          name: "サンプル担当者",
          detail: "企業管理者",
          status: "有効",
          history: [],
        },
        {
          id: demoId(6),
          kind: "environment",
          name: "サンプル企業",
          detail: "三業態共通テンプレート",
          status: "利用中",
          history: [],
        },
        {
          id: demoId(7),
          kind: "support",
          name: "撮影結果の調査",
          detail: "サンプル案件のみ・閲覧限定・2099年末まで",
          status: "許可中",
          history: [],
        },
      ],
    },
  };
}
