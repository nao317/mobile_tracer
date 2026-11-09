// @vitest-environment node
import { describe, it, expect } from "vitest";
import { formDate } from "./api.server";
describe("case deadline timezone", () => {
  it("stores Tokyo local time as UTC", () => {
    expect(formDate("2030-11-09T18:00", "-540")).toBe(
      "2030-11-09T09:00:00.000Z",
    );
  });
  it("rejects missing dates", () => {
    expect(() => formDate(null, "0")).toThrow();
  });
});
