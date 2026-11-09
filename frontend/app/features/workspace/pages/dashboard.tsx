import { HistoryList } from "../../history/history-list";
import { useWorkspace } from "../workspace-context";

export function DashboardScreen() {
  const { snapshot } = useWorkspace();
  return <HistoryList data={snapshot.versions.map(v => ({ target_type: "record_version" as const, target_id: v.id, action: "draft.update", decision: "", at: v.submitted_at ?? v.created_at, count: 1, own_application: true }))} pagination={{ page: 1, page_size: 20, total: snapshot.versions.length }} />;
}
