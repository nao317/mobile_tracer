import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, Link, Outlet, RouterProvider, useLoaderData } from "react-router";
import { describe, expect, it } from "vitest";
import { DisplaySettingsProvider, useDisplaySettings, useI18n } from "../components/ui/display-settings";
function Probe() {
  const display = useDisplaySettings();
  const { t, language } = useI18n();
  return <><p>{language}: {display.theme}: {t("navigation.home")}</p><button onClick={() => display.setLanguage("en")}>English</button><button onClick={() => display.setTheme("dark")}>Dark</button></>;
}
describe("display settings i18n compatibility", () => {
  it("keeps a locale change when an earlier asynchronous loader response arrives", async () => {
    let finishReload: (() => void) | undefined;
    let calls = 0;
    function AsyncLayout() {
      const initial = useLoaderData<{ language: "ja"; theme: "light" }>();
      return <DisplaySettingsProvider initialLanguage={initial.language} initialTheme={initial.theme}><Probe /><Link to="/next">Next route</Link><Outlet /></DisplaySettingsProvider>;
    }
    const router = createMemoryRouter([{
      id: "root",
      path: "/",
      element: <AsyncLayout />,
      shouldRevalidate: () => true,
      loader: async () => {
        if (++calls > 1) await new Promise<void>(resolve => { finishReload = resolve; });
        return { language: "ja" as const, theme: "light" as const };
      },
      children: [{ index: true, element: <p>First route</p> }, { path: "next", element: <p>Next route loaded</p> }],
    }]);
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("ja: light: ホーム")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Next route" }));
    await waitFor(() => expect(finishReload).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    await act(async () => { finishReload!(); });
    expect(await screen.findByText("Next route loaded")).toBeInTheDocument();
    expect(screen.getByText("en: dark: Home")).toBeInTheDocument();
    expect(document.cookie).toContain("mt_locale=en");
    expect(document.cookie).toContain("mt_theme=dark");
    router.dispose();
  });
  it("renders cookie-selected locale and theme during SSR", () => {
    const markup = renderToString(<DisplaySettingsProvider initialLanguage="en" initialTheme="dark"><Probe /></DisplaySettingsProvider>);
    expect(markup).toContain("Home");
    expect(markup).toContain("dark");
    expect(markup).not.toContain("ホーム");
  });
  it("keeps the login settings API and persists updated preferences", () => {
    render(<DisplaySettingsProvider initialLanguage="ja" initialTheme="light"><Probe /></DisplaySettingsProvider>);
    expect(screen.getByText("ja: light: ホーム")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(screen.getByText("en: dark: Home")).toBeInTheDocument();
    expect(document.cookie).toContain("mt_locale=en");
    expect(document.cookie).toContain("mt_theme=dark");
  });
});
