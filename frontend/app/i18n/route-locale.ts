import type { Language } from "./index";
export function routeLocale(matches: ({ id: string; loaderData: unknown } | undefined)[]): Language {
  const root = matches.find(match => match?.id === "root")?.loaderData;
  return root && typeof root === "object" && "language" in root && root.language === "en" ? "en" : "ja";
}
