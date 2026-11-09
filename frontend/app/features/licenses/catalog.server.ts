import catalog from "./catalog.generated.json";
import { clientPage } from "../management/navigation";

export function licensePage(request: Request) {
  return clientPage(catalog.packages, new URL(request.url).searchParams.get("page"), 10);
}

export type LicensePageData = ReturnType<typeof licensePage>;
