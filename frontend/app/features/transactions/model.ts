import { z } from "zod";
import { versionSchema, caseSchema, vehicleSchema } from "../workspace/model";
export const requestSchema = z.object({
  id: z.string(),
  version_id: z.string(),
  user_id: z.string(),
  qualification: z.string(),
  kind: z.string(),
  statement: z.string(),
  deadline: z.string(),
  decision: z.string().nullable(),
  responded_at: z.string().nullable(),
});
export const transactionSchema = z.object({
  api_configured:z.boolean().default(false),
  content: z.object({
    schema: z.string(),
    presented_at: z.string().nullable().default(null),
    version: versionSchema,
    case: caseSchema,
    vehicle: vehicleSchema,
    media: z.array(
      z.object({
        id: z.string(),
        position: z.string(),
        mime_type: z.string(),
        sha256: z.string(),
        actor_id: z.string(),
        device_captured_at: z.string().nullable(),
        created_at: z.string(),
      }),
    ),
  }),
  requests: z.array(requestSchema),
  can_manage: z.boolean(),
  anchor: z
    .object({
      status: z.string(),
      manifest_hash: z.string(),
      txid: z.string().nullable(),
      attempts: z.number(),
      registered_at: z.string().nullable(),
    })
    .nullable(),
});
export type Transaction = z.infer<typeof transactionSchema>;
export const transactionListSchema = z.object({
  data: z.array(
    z.object({
      version_id: z.string(),
      case_id: z.string(),
      record_id: z.string(),
      version_no: z.number(),
      status: z.string(),
      vehicle_id: z.string(),
      model_name: z.string().nullable(),
    }),
  ),
  pagination: z.object({
    page: z.number(),
    page_size: z.number(),
    total: z.number(),
  }),
});
export const ownersSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      user_id: z.string(),
      effective_at: z.string(),
      created_at: z.string(),
    }),
  ),
});
export const labels: Record<string, string> = {
  view: "閲覧確認",
  receipt: "受領確認",
  state_agreement: "車両状態への同意",
  work_authorization: "作業承認",
  approved: "承認",
  rejected: "拒否",
  held: "保留",
  queued: "登録待ち",
  sending: "送信・ブロック確認待ち",
  unknown: "結果未確定",
  registered: "登録済み",
  failed: "登録失敗",
  match: "一致",
  mismatch: "不一致",
  unverifiable: "検証不能",
};
