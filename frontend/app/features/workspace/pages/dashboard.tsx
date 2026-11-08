import { useRouteLoaderData } from "react-router";
import { ActivityHistory, activityKey } from "../../../components/templates/activity-history";
import type { loader as rootLoader } from "../../../root";
import { useWorkspace } from "../workspace-context";

export function DashboardScreen() {
  const { mode } = useWorkspace();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  return <ActivityHistory storageKey={activityKey(root?.session?.user.email, mode === "preview")} />;
}
