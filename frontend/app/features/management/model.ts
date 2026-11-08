import type { ShouldRevalidateFunctionArgs } from "react-router";
import { z } from "zod";
import { idSchema, paginationSchema } from "../workspace/model";

export const accountLabels = {
  general: "一般ユーザー",
  business: "業者ユーザー",
} as const;
export const requestLabels = {
  business_upgrade: "業者ユーザーへの変更",
  company_create: "企業・プロファイル作成",
  company_profile_update: "企業プロファイル変更",
} as const;
export const requestStatusLabels = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "拒否",
} as const;
export const companyStatusLabels: Record<string, string> = {
  active: "有効",
  suspended: "停止",
  provisioning: "準備中",
  closed: "終了",
};
export const managedUserSchema = z.object({
  id: idSchema,
  email: z.string(),
  email_verified: z.boolean(),
  display_name: z.string(),
  account_type: z.enum(["general", "business"]),
  status: z.enum(["active", "suspended"]),
  version: z.number().int().nonnegative(),
  created_at: z.string(),
});
export const profileSchema = z.object({
  legal_name: z.string(),
  description: z.string(),
  website: z.string(),
  phone: z.string(),
  address: z.string(),
  contact_email: z.string(),
  business_types: z.array(z.enum(["rental", "dealer", "repair"])),
});
export const companySchema = z.object({
  id: idSchema,
  name: z.string(),
  status: z.enum(["active", "suspended", "provisioning", "closed"]),
  profile: profileSchema,
  version: z.number().int().nonnegative(),
  created_at: z.string(),
});
export const managementRequestSchema = z.object({
  id: idSchema,
  requester_id: idSchema,
  requester_email: z.string().optional(),
  decider_email: z.string().optional(),
  request_key: idSchema,
  kind: z.enum([
    "business_upgrade",
    "company_create",
    "company_profile_update",
  ]),
  company_id: idSchema.nullable(),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "approved", "rejected"]),
  created_at: z.string(),
  decided_by: idSchema.nullable(),
  decided_at: z.string().nullable(),
  decision_reason: z.string(),
});
export const memberSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  staff_id: idSchema,
  display_name: z.string(),
  email: z.string(),
  role: z.string(),
  revoked_at: z.string().nullable(),
});
export const overviewSchema = z.object({
  users: z.number(),
  business_users: z.number(),
  companies: z.number(),
  pending_requests: z.number(),
});
export const usersPageSchema = z.object({
  data: z.array(managedUserSchema),
  pagination: paginationSchema,
});
export const companiesPageSchema = z.object({
  data: z.array(companySchema),
  pagination: paginationSchema,
});
export const requestsPageSchema = z.object({
  data: z.array(managementRequestSchema),
  pagination: paginationSchema,
});
export type ManagedUser = z.infer<typeof managedUserSchema>;
export type Company = z.infer<typeof companySchema>;
export type CompanyProfile = z.infer<typeof profileSchema>;
export type ManagementRequest = z.infer<typeof managementRequestSchema>;
export type Member = z.infer<typeof memberSchema>;
export type ManagementResult = {
  error?: string;
  fields?: Record<string, string[]>;
  message?: string;
  uncertain?: boolean;
};

export function managementRevalidate({
  actionStatus,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return actionStatus && actionStatus >= 400 ? false : defaultShouldRevalidate;
}
