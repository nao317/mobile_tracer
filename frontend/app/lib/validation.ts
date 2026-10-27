import type { ZodError } from "zod";
import ja from "zod/v4/locales/ja.js";

// Pass these options to safeParse / safeParseAsync without changing global config.
export const validationOptions = { error: ja().localeError };

export type ValidationErrors = {
  formErrors: string[];
  fieldErrors: Partial<Record<string, string[]>>;
};

/** Group issues by dot-separated field paths, including array indices. */
export function toValidationErrors(error: ZodError): ValidationErrors {
  const formErrors: string[] = [];
  const fields = new Map<string, string[]>();

  for (const issue of error.issues) {
    if (issue.path.length === 0) {
      formErrors.push(issue.message);
      continue;
    }

    const path = issue.path.map(String).join(".");
    const messages = fields.get(path) ?? [];
    messages.push(issue.message);
    fields.set(path, messages);
  }

  return { formErrors, fieldErrors: Object.fromEntries(fields) };
}
