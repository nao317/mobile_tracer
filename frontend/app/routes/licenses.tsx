import type { Route } from "./+types/licenses";
import { LicenseList } from "../features/licenses/license-list";
import { licensePage } from "../features/licenses/catalog.server";
import { createTranslator } from "../i18n";
import { routeLocale } from "../i18n/route-locale";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: `${createTranslator(routeLocale(matches))("licenses.title")} | Mobile Tracer` }];
}

// Notices are public and available even when the authentication API is down.
export function loader({ request }: Route.LoaderArgs) {
  return licensePage(request);
}

export default function Licenses({ loaderData }: Route.ComponentProps) {
  return <LicenseList {...loaderData} />;
}
