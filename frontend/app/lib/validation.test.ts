import { describe, expect, expectTypeOf, it } from "vitest";
import * as z from "zod";

import { toValidationErrors, validationOptions } from "./validation";

// Illustrative form constraints, not product business rules.
const exampleSchema = z.object({
  title: z.string().trim().min(1, "件名を入力してください。"),
  count: z.string()
    .trim()
    .min(1, "件数を入力してください。")
    .regex(/^[0-9]+$/, "件数は半角数字で入力してください。")
    .pipe(
      z.coerce.number<string>().int()
        .min(1, "件数は1以上にしてください。")
        .max(99, "件数は99以下にしてください。"),
    ),
  note: z.string().trim().optional(),
});

function validate(input: unknown) {
  return exampleSchema.safeParse(input, validationOptions);
}

function errorsFor(input: unknown) {
  const result = validate(input);
  if (result.success) throw new Error("Expected invalid example input");
  return toValidationErrors(result.error);
}

describe("form validation", () => {
  it.each(["1", "99"])("accepts boundary count %s", (count) => {
    const result = validate({ title: " 記録 ", count });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data).toEqual({ title: "記録", count: Number(count) });
    expectTypeOf(result.data).toEqualTypeOf<z.infer<typeof exampleSchema>>();
    expectTypeOf<z.input<typeof exampleSchema>["count"]>().toEqualTypeOf<string>();
    expectTypeOf<z.output<typeof exampleSchema>["count"]>().toEqualTypeOf<number>();
  });

  it.each(["", "   "])("rejects blank %j before number coercion", (blank) => {
    const errors = errorsFor({ title: blank, count: blank });

    expect(errors.fieldErrors.title).toEqual(["件名を入力してください。"]);
    expect(errors.fieldErrors.count).toContain("件数を入力してください。");
    expect(errors.fieldErrors.count).not.toContain("件数は1以上にしてください。");
    expect(errors.formErrors).toEqual([]);
  });

  it.each(["abc", "1.5", "-1", "1e1", "０１"])("rejects non-digit count %j", (count) => {
    expect(errorsFor({ title: "記録", count }).fieldErrors.count).toEqual([
      "件数は半角数字で入力してください。",
    ]);
  });

  it.each([
    ["0", "件数は1以上にしてください。"],
    ["100", "件数は99以下にしてください。"],
  ])("rejects out-of-range count %s", (count, message) => {
    expect(errorsFor({ title: "記録", count }).fieldErrors.count).toEqual([message]);
  });

  it.each([undefined, null, 1])("uses Japanese fallback for invalid title %j", (title) => {
    const messages = errorsFor({ title, count: "1" }).fieldErrors.title;

    expect(messages).toHaveLength(1);
    expect(messages?.[0]).toMatch(/[ぁ-んァ-ヶ一-龠]/);
  });

  it("normalizes an optional note while preserving missing and empty values", () => {
    expect(validate({ title: "記録", count: "1", note: " メモ " })).toMatchObject({
      success: true,
      data: { note: "メモ" },
    });
    expect(validate({ title: "記録", count: "1", note: " " })).toMatchObject({
      success: true,
      data: { note: "" },
    });
    expect(validate({ title: "記録", count: "1", note: null }).success).toBe(false);
  });

  it("rejects a file where a text field is expected", () => {
    const formData = new FormData();
    formData.set("title", new File(["contents"], "record.txt"));
    formData.set("count", "1");

    expect(errorsFor(Object.fromEntries(formData)).fieldErrors.title).toHaveLength(1);
  });

  it("supports Japanese errors for asynchronous validation", async () => {
    const schema = z.string().refine(async () => false);
    const result = await schema.safeParseAsync("記録", validationOptions);
    if (result.success) throw new Error("Expected an async validation error");

    expect(toValidationErrors(result.error)).toEqual({
      formErrors: ["無効な入力"],
      fieldErrors: {},
    });
  });
});

describe("toValidationErrors", () => {
  it("keeps nested and array paths distinct and preserves multiple messages", () => {
    const schema = z.object({
      contact: z.object({
        name: z.string().min(2, "2文字以上にしてください。")
          .regex(/^[a-z]+$/, "半角英字で入力してください。"),
      }),
      members: z.array(z.object({
        name: z.string().min(1, "名前を入力してください。"),
      })),
    });
    const result = schema.safeParse({
      contact: { name: "1" },
      members: [{ name: "" }, { name: "" }],
    });
    if (result.success) throw new Error("Expected field errors");

    expect(toValidationErrors(result.error)).toEqual({
      formErrors: [],
      fieldErrors: {
        "contact.name": [
          "2文字以上にしてください。", "半角英字で入力してください。",
        ],
        "members.0.name": ["名前を入力してください。"],
        "members.1.name": ["名前を入力してください。"],
      },
    });
  });

  it("separates form errors from field errors and retains custom messages", () => {
    const schema = z.object({
      title: z.string().min(1, "件名を入力してください。"),
    }).refine(() => false, "入力内容を確認してください。");
    const result = schema.safeParse({ title: "" }, validationOptions);
    if (result.success) throw new Error("Expected form and field errors");

    expect(toValidationErrors(result.error)).toEqual({
      formErrors: ["入力内容を確認してください。"],
      fieldErrors: { title: ["件名を入力してください。"] },
    });
  });

  it("handles field names that overlap with object prototype properties", () => {
    const error = new z.ZodError(
      ["__proto__", "constructor", "toString"].map((key) => ({
        code: "custom",
        path: [key],
        message: `${key}を確認してください。`,
      })),
    );
    const errors = toValidationErrors(error);

    for (const key of ["__proto__", "constructor", "toString"]) {
      expect(Object.hasOwn(errors.fieldErrors, key)).toBe(true);
      expect(errors.fieldErrors[key]).toEqual([`${key}を確認してください。`]);
    }
    expect(errors.fieldErrors["missing"]).toBeUndefined();
  });
});
