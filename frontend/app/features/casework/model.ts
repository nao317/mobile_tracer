import { z } from "zod";
import {
  caseSchema,
  vehicleSchema,
  paginationSchema,
} from "../workspace/model";
export const startSchema = z.object({
  id: z.string(),
  case_id: z.string(),
  version_no: z.number(),
  customer_id: z.string(),
  actor_id: z.string(),
  terms_hash: z.string(),
  deadline: z.string(),
  created_at: z.string(),
  decision: z.string().nullable(),
  responded_at: z.string().nullable(),
});
export const termsSchema = z.object({
  company_name: z.string().default(""),
  store_name: z.string().default(""),
  schema: z.string(),
  case: caseSchema,
  vehicle: vehicleSchema,
  terms: z.string(),
  customer_id: z.string(),
  actor_id: z.string(),
  deadline: z.string(),
});
export const eventSchema = z.object({
  id: z.string(),
  case_id: z.string(),
  actor_id: z.string(),
  origin: z.enum(["business", "customer"]),
  kind: z.enum(["work", "progress_report", "incident", "request"]),
  title: z.string(),
  description: z.string(),
  amount_minor: z.number().nullable(),
  target_stage: z.string().nullable(),
  deadline: z.string(),
  supersedes_id: z.string().nullable(),
  parent_event_id: z.string().nullable(),
  created_at: z.string(),
});
export const actionSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  actor_id: z.string(),
  action: z.string(),
  detail: z.string(),
  sequence: z.number(),
  created_at: z.string(),
});
export const eventViewSchema = z.object({
  event: eventSchema,
  state: z.string(),
  actions: z.array(actionSchema),
  superseded: z.boolean(),
});
export const registrationSchema = z.object({
  id: z.string(),
  subject_type: z.string(),
  subject_id: z.string(),
  manifest_hash: z.string(),
  status: z.string(),
  timestamp_id: z.number().nullable(),
  txid: z.string().nullable(),
  attempts: z.number(),
  updated_at: z.string(),
  confirmed_at: z.string().nullable(),
});
export const caseworkSchema = z.object({
  next_stages: z.array(z.string()).default([]),
  case: caseSchema,
  vehicle: vehicleSchema,
  start: startSchema,
  terms: termsSchema,
  can_manage: z.boolean(),
  events: z.array(eventViewSchema),
  registrations: z.array(registrationSchema),
  api_configured: z.boolean(),
});
export const caseworkListSchema = z.object({
  data: z.array(caseSchema.extend({ has_start: z.boolean() })),
  pagination: paginationSchema,
  api_configured: z.boolean(),
});
export const startInboxSchema = z.object({
  data: z.array(z.object({ request: startSchema, terms: termsSchema })),
});
export type Casework = z.infer<typeof caseworkSchema>;
export type EventView = z.infer<typeof eventViewSchema>;
export const labels: Record<string, string> = {
  awaiting_customer: "案件開始の承認待ち",
  in_progress: "進行中",
  completed: "完了",
  cancelled: "中止",
  pending: "回答待ち",
  approved: "承認済み",
  rejected: "拒否",
  held: "保留",
  returned: "差戻し",
  awaiting_completion: "顧客の完了確認待ち",
  executed: "着手",
  reported: "結果報告",
  work: "作業提案",
  progress_report: "進捗報告",
  incident: "インシデント報告",
  request: "依頼",
  queued: "登録待ち",
  submitting: "送信中",
  unconfirmed: "ブロック確認待ち",
  confirmed: "登録済み",
  unknown: "登録結果を照会中",
  failed: "登録要求が拒否されました",
  case_start: "案件開始の合意",
  event_approval: "提案・報告への合意",
  event_completion: "対応完了の確認",
  match: "一致",
  mismatch: "不一致",
  unverifiable: "検証不能",
};
