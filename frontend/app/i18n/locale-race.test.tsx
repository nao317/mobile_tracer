import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { expect, it } from "vitest";
import { DisplaySettingsProvider, useDisplaySettings } from "../components/ui/display-settings";
import { useLogin } from "../features/auth/use-login";
function App() {
  const display = useDisplaySettings();
  return <><p>global:{display.language}/{display.theme}</p><button onClick={() => { display.setLanguage("en"); display.setTheme("dark"); }}>English dark</button><button onClick={() => { display.setLanguage("ja"); display.setTheme("light"); }}>Japanese light</button><Link to="/login">Sign in</Link><Outlet /></>;
}
function LoginProbe({ initialLanguage = "ja", initialTheme = "light" }: { initialLanguage?: "ja" | "en"; initialTheme?: "light" | "dark" }) {
  const login = useLogin({ config: null, error: "", initialLanguage, initialTheme });
  return <p>login:{login.language}/{login.theme}</p>;
}
it("retains the current preferences when a stale login loader finishes", async () => {
  let finish: (() => void) | undefined;
  const router = createMemoryRouter([{ path: "/", element: <App />, children: [{ index: true, element: <p>Start</p> }, { path: "login", loader: () => new Promise(resolve => { finish = () => resolve(null); }), element: <LoginProbe /> }] }]);
  render(<DisplaySettingsProvider initialLanguage="ja" initialTheme="light"><RouterProvider router={router} /></DisplaySettingsProvider>);
  fireEvent.click(screen.getByRole("link", { name: "Sign in" }));
  fireEvent.click(screen.getByRole("button", { name: "English dark" }));
  await act(async () => { finish!(); });
  expect(screen.getByText("global:en/dark")).toBeInTheDocument();
  expect(screen.getByText(/^login:/)).toHaveTextContent("login:en/dark");
  expect(document.documentElement.lang).toBe("en");
  fireEvent.click(screen.getByRole("button", { name: "Japanese light" }));
  expect(screen.getByText(/^login:/)).toHaveTextContent("login:ja/light");
  router.dispose();
});
it("preserves standalone login preferences without a display provider", () => {
  render(<LoginProbe initialLanguage="en" initialTheme="dark" />);
  expect(screen.getByText(/^login:/)).toHaveTextContent("login:en/dark");
});
