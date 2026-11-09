import { z } from "zod";

// Matches the UUID format accepted by the existing Go API (including seed IDs).
export const idSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const businessTypes = {
  rental: "レンタカー・カーシェア",
  dealer: "販売店",
  repair: "整備・修理",
} as const;
export type BusinessType = keyof typeof businessTypes;
export const roleLabels = {
  tenant_admin: "企業管理者",
  store_manager: "店舗責任者",
  staff: "担当者",
  auditor: "監査担当",
} as const;
export type Role = keyof typeof roleLabels;
export const fieldRuleSchema = z.object({
  type: z.enum(["string", "integer", "number", "boolean"]),
  required: z.boolean().optional(),
  nullable: z.boolean().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  max_length: z.number().int().nonnegative().optional(),
  enum: z.array(z.string()).optional(),
});
export const businessRuleSchema = z.object({
  stages: z.array(z.string()),
  transitions: z.record(z.string(), z.array(z.string())),
  record_kinds: z.record(
    z.string(),
    z.object({ fields: z.record(z.string(), fieldRuleSchema) }),
  ),
});
export const settingsSchema = z.object({
  schema_version: z.literal(1),
  businesses: z.record(z.string(), businessRuleSchema),
});
export const contextSchema = z.object({
  principal: z.object({
    tenant_id: idSchema,
    staff_id: idSchema,
    roles: z.array(
      z.object({ role: z.string(), store_id: idSchema.nullable() }),
    ),
  }),
  stores: z.array(z.object({ id: idSchema, name: z.string() })),
  configuration: z
    .object({ id: idSchema, settings: settingsSchema })
    .nullable(),
});
export const vehicleSchema = z.object({
  id: idSchema,
  model_name: z.string().nullable(),
  created_at: z.string(),
  identifiers: z.array(
    z.object({
      id: idSchema,
      kind: z.string(),
      value: z.string(),
      valid_from: z.string().nullable(),
      valid_to: z.string().nullable(),
      verified_at: z.string().nullable(),
    }),
  ),
});
export const caseSchema = z.object({
  id: idSchema,
  store_id: idSchema,
  vehicle_id: idSchema,
  case_type: z.enum(["rental", "dealer", "repair"]),
  configuration_version_id: idSchema,
  assignee_id: idSchema.nullable(),
  stage: z.string(),
  status: z.enum(["awaiting_customer", "in_progress", "completed", "cancelled"]),
  created_by: idSchema,
  created_at: z.string(),
  cancel_reason: z.string().nullable().optional(),
});
export const recordSchema = z.object({
  id: idSchema,
  case_id: idSchema,
  record_kind: z.string(),
  created_by: idSchema,
  created_at: z.string(),
});
export const versionSchema = z.object({
  id: idSchema,
  case_id: idSchema,
  record_id: idSchema,
  version_no: z.number().int(),
  status: z.enum(["draft", "submitted"]),
  configuration_version_id: idSchema,
  lock_version: z.number().int(),
  based_on_version_id: idSchema.nullable(),
  change_reason: z.string().nullable(),
  submitted_at: z.string().nullable(),
  created_at: z.string(),
  entries: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
});
export const paginationSchema = z.object({
  page: z.number().int().positive(),
  page_size: z.number().int().positive().max(100),
  total: z.number().int().nonnegative(),
});
export type BusinessContext = z.infer<typeof contextSchema>;
export type Vehicle = z.infer<typeof vehicleSchema>;
export type BusinessCase = z.infer<typeof caseSchema>;
export type RecordItem = z.infer<typeof recordSchema>;
export type Version = z.infer<typeof versionSchema>;
export type FieldRule = z.infer<typeof fieldRuleSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type Photo = {
  id: string;
  versionId: string;
  position: string;
  name: string;
  status: "saved" | "failed" | "exception";
  note: string;
  receivedAt: string;
  src?: string;
};
export type Answer = {
  id: string;
  versionId: string;
  person: string;
  kind: string;
  response: string;
  text: string;
  at: string;
};
export type Dispute = {
  id: string;
  caseId: string;
  versionId: string;
  text: string;
  status: string;
  history: string[];
};
export type Share = {
  id: string;
  versionId: string;
  recipient: string;
  expires: string;
  scope: string;
  status: "active" | "revoked" | "expired";
};
export type Audit = {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
};
export type ManagementItem = {
  id: string;
  kind: string;
  name: string;
  detail: string;
  status: string;
  history: string[];
};
export type Workflow = {
  publicMasks?: Record<string, boolean>;
  photos: Photo[];
  answers: Answer[];
  disputes: Dispute[];
  shares: Share[];
  registration: Record<string, string>;
  verification: Record<string, string>;
  audit: Audit[];
  management: ManagementItem[];
};
export type WorkspaceData = {
  context: BusinessContext;
  asOf?: string;
  configurations?: Record<
    string,
    NonNullable<BusinessContext["configuration"]>["settings"]
  >;
  vehicles: Vehicle[];
  cases: BusinessCase[];
  records: RecordItem[];
  /** Current history page; the viewed/edited version is selected separately. */
  versions: Version[];
  /** Top-level list, including the vehicle search on the case creation screen. */
  pagination?: Pagination;
  vehiclesPagination?: Pagination;
  casesPagination?: Pagination;
  relatedPagination?: Pagination;
  recordsPagination?: Pagination;
  historyPagination?: Pagination;
  selectedVehicle?: Vehicle | null;
  selectedVersion?: Version | null;
  workflow: Workflow | null;
  notice?: string;
};
export type CommandResult = {
  /** Stable result identifier for localization; existing messages remain available. */
  code?: string;
  error?: string;
  fields?: Record<string, string[]>;
  message?: string;
  redirectTo?: string;
  uncertain?: boolean;
};

export function canManage(context: BusinessContext, storeId?: string) {
  return context.principal.roles.some(
    (r) =>
      (r.role === "tenant_admin" || r.role === "store_manager") &&
      (!r.store_id || r.store_id === storeId),
  );
}
export function canWrite(context: BusinessContext, item?: BusinessCase) {
  if (!item)
    return context.principal.roles.some((r) =>
      ["tenant_admin", "store_manager", "staff"].includes(r.role),
    );
  if (item.status !== "in_progress") return false;
  return (
    canManage(context, item.store_id) ||
    context.principal.roles.some(
      (r) =>
        r.role === "staff" &&
        (!r.store_id || r.store_id === item.store_id) &&
        (item.created_by === context.principal.staff_id ||
          item.assignee_id === context.principal.staff_id),
    )
  );
}
export function isTenantAdmin(context: BusinessContext) {
  return context.principal.roles.some((r) => r.role === "tenant_admin");
}
export function vehicleName(vehicle?: Vehicle) {
  return vehicle?.model_name || "車種名未設定";
}
export function plateNumber(vehicle?: Vehicle) {
  return (
    vehicle?.identifiers.find((i) => i.kind === "plate_number" && !i.valid_to)
      ?.value || "ナンバー未設定"
  );
}
export function formatDate(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat("ja-JP", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Tokyo",
      }).format(new Date(value))
    : "—";
}
export const fieldLabels: Record<string, string> = {
  odometer: "走行距離（km）",
  fuel_level: "燃料残量（%）",
  notes: "記録メモ",
  inspected: "点検実施",
  estimate: "見積金額（円）",
  work_scope: "作業範囲",
};
export const stageLabels: Record<string, string> = {
  intake: "受付",
  inspection: "状態確認",
  checkout: "貸出",
  returned: "返却",
  preparation: "販売準備",
  delivery: "納車",
  estimate: "見積確認",
  work: "作業",
  handover: "引き渡し",
  completed: "完了",
};

export function rulesFor(
  data: Pick<WorkspaceData, "context" | "configurations">,
  item: BusinessCase,
) {
  const settings =
    data.configurations?.[item.configuration_version_id] ??
    (data.context.configuration?.id === item.configuration_version_id
      ? data.context.configuration.settings
      : undefined);
  return settings?.businesses[item.case_type];
}

/** Preserve omitted draft fields; only explicit removals delete an existing value. */
export function entriesFromForm(
  form: FormData,
  rules: Record<string, FieldRule>,
  existing: Version["entries"] = {},
) {
  const entries: Version["entries"] = Object.assign(
    Object.create(null),
    existing,
  );
  const fields: Record<string, string[]> = {};
  for (const [key, rule] of Object.entries(rules)) {
    if (form.get(`remove:${key}`) === "1") {
      delete entries[key];
      continue;
    }
    if (form.get(`null:${key}`) === "1") {
      if (rule.nullable) entries[key] = null;
      else fields[`entry:${key}`] = ["この項目はnullにできません。"];
      continue;
    }
    if (!form.has(`entry:${key}`)) continue;
    const raw = form.get(`entry:${key}`);
    if (typeof raw !== "string") {
      fields[`entry:${key}`] = ["入力形式を確認してください。"];
      continue;
    }
    if (raw === "" && rule.type !== "string") {
      delete entries[key];
      continue;
    }
    if (rule.type === "string") {
      if (
        (rule.max_length !== undefined && [...raw].length > rule.max_length) ||
        (rule.enum && !rule.enum.includes(raw))
      )
        fields[`entry:${key}`] = ["文字数または選択肢を確認してください。"];
      else entries[key] = raw;
    } else if (rule.type === "boolean") {
      if (raw === "true" || raw === "false") entries[key] = raw === "true";
      else fields[`entry:${key}`] = ["実施・未実施を選択してください。"];
    } else {
      const value = Number(raw);
      if (
        !raw.trim() ||
        !Number.isFinite(value) ||
        (rule.type === "integer" &&
          (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(value))) ||
        (rule.minimum !== undefined && value < rule.minimum) ||
        (rule.maximum !== undefined && value > rule.maximum)
      )
        fields[`entry:${key}`] = ["数値の形式と範囲を確認してください。"];
      else entries[key] = value;
    }
  }
  return { entries, fields };
}
