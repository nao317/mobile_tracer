import { describe, expect, it } from "vitest";
import { loginSuccessPath } from "./use-login";

describe("login destination", () => {
  it("opens the home screen after session exchange", () => {
    expect(loginSuccessPath).toBe("/app");
  });
});
