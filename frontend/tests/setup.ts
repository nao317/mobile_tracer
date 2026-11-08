import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom does not implement matchMedia; use reduced motion for DOM tests.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (media) => ({
    matches: media.includes("prefers-reduced-motion"), media, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {},
    removeEventListener() {}, dispatchEvent: () => false,
  });
}
afterEach(cleanup);
