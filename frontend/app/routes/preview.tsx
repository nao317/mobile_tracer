import { data } from "react-router";
import type { Route } from "./+types/preview";
import { previewEnabled } from "../features/workspace/api.server";
import { createPreviewManagementReviewData } from "../features/workspace/preview-management/view-catalog";
import { resolveScreen } from "../features/workspace/screens";
import { PreviewProvider } from "../features/workspace/workspace-context";
import { WorkspaceView } from "../features/workspace/workspace-view";
import { screenTitle } from "../i18n";
import { routeLocale } from "../i18n/route-locale";

export function meta({ matches, loaderData }: Route.MetaArgs) {
  return [
    { title: `${screenTitle(routeLocale(matches), loaderData?.screen.key ?? "catalog")} | Mobile Tracer` },
    { name: "robots", content: "noindex, nofollow" },
  ];
}
export function headers() {
  return {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  };
}
export async function loader({ params }: Route.LoaderArgs) {
  if (!previewEnabled()) throw new Response("Not Found", { status: 404 });
  const screen = resolveScreen(params["*"] ?? "");
  if (!screen) throw new Response("Not Found", { status: 404 });
  return data(
    { snapshot: createPreviewManagementReviewData(), screen },
    { headers: headers() },
  );
}
export default function Preview({ loaderData }: Route.ComponentProps) {
  return (
    <PreviewProvider initial={loaderData.snapshot}>
      <WorkspaceView screen={loaderData.screen} />
    </PreviewProvider>
  );
}
