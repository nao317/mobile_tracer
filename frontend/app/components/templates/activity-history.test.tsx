import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ActivityHistory, readActivity, recordActivity } from "./activity-history";
import { DisplaySettingsProvider } from "../ui/display-settings";

beforeEach(() => localStorage.clear());
describe("activity history", () => {
  it("keeps histories isolated and rejects invalid stored links", () => {
    recordActivity("user-a", "/app/cases", "Cases");
    expect(readActivity("user-b")).toEqual([]);
    localStorage.setItem("unsafe", JSON.stringify([{ path: "//example.com", title: "Bad", at: new Date().toISOString() }]));
    expect(readActivity("unsafe")).toEqual([]);
    expect(readActivity("user-a")).toHaveLength(1);
  });
  it("shows only the requested twenty-item page", async () => {
    for (let i = 0; i < 25; i++) recordActivity("history", `/app/cases/${i}`, `Case ${i}`);
    const router = createMemoryRouter([{ path: "*", element: <DisplaySettingsProvider initialLanguage="en" initialTheme="light"><ActivityHistory storageKey="history" /></DisplaySettingsProvider> }], { initialEntries: ["/app?page=2"] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("link", { name: "Case 4" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Case 5" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Case 0" })).toBeVisible();
  });
});
