import { z } from "zod";
import { idSchema, paginationSchema } from "../workspace/model";

export const historyItemSchema = z.object({
  target_type: z.enum(["record_version", "case", "management_request"]),
  target_id: idSchema,
  action: z.string(),
  decision: z.string(),
  at: z.string(),
  count: z.number().int().positive(),
  own_application: z.boolean().default(true),
});
export const historyPageSchema = z.object({ data: z.array(historyItemSchema), pagination: paginationSchema });
export type HistoryPage = z.infer<typeof historyPageSchema>;
