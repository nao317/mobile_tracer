import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    include: ["app/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
  },
});
