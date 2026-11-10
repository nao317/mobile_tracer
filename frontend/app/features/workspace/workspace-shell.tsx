import type { ReactNode } from "react";
import { useRouteLoaderData, useSearchParams } from "react-router";
import { AuthenticatedLayout } from "../../components/templates/authenticated-layout";
import { useTranslation, useI18n } from "../../components/ui/display-settings";
import { Alert, Button, EmptyState, Select } from "../../components/ui/primitives";
import { settingsNavigation } from "../settings/navigation";
import type { loader as rootLoader } from "../../root";
import { useWorkspace } from "./workspace-context";
import { workspaceNavigation, type Screen } from "./screens";
import { roleLabels, type Role } from "./model";
import styles from "./workspace-shell.module.css";

export function WorkspaceShell({ children, screen }: { children: ReactNode; screen: Screen }) {
  const { base, mode, snapshot, reset, changeRole } = useWorkspace();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const t = useTranslation();
  const { enumLabel, screenTitle } = useI18n();
  const [search, setSearch] = useSearchParams();
  const scenario = mode === "preview" ? search.get("scenario") ?? "normal" : "normal";
  const business = workspaceNavigation({ base, mode, context: snapshot.context, caseId: screen.params.caseId, recordId: screen.params.recordId }, t).map(group => ({ ...group, items: group.items.map(item => {
    if (!screen.params.caseId || !item.to.startsWith(`${base}/cases/${screen.params.caseId}`)) return item;
    const query = new URLSearchParams();
    for (const key of ["version", "returnTo"]) {
      const value = search.get(key);
      if (value) query.set(key, value);
    }
    return { ...item, to: `${item.to}${query.size ? `?${query}` : ""}` };
  }) }));
  const common = settingsNavigation(t, root?.session);
  const grouped = new Map(business.map(group => [group.id, { ...group, items: [...group.items] }]));
  for (const group of common) {
    const existing = grouped.get(group.id);
    if (existing) existing.items.push(...group.items.filter(item => !existing.items.some(link => link.to === item.to)));
    else grouped.set(group.id, group);
  }
  const groups = [...grouped.values()];
  return <AuthenticatedLayout groups={groups} session={root?.session} title={screenTitle(screen.key)}>
    {mode === "preview" && <details className={styles.preview}><summary>{t("navigation.preview")}</summary>
      <p>{t("entry.previewNotice")}</p>
      <div className={styles.controls}>
        <label>{t("entry.previewRole")}<Select aria-label={t("entry.previewRole")} value={snapshot.context.principal.roles[0]?.role} onChange={event => changeRole?.(event.target.value as Role)}>{Object.keys(roleLabels).map(role => <option value={role} key={role}>{enumLabel("role", role)}</option>)}</Select></label>
        <label>{t("navigation.scenario")}<Select aria-label={t("navigation.scenario")} value={scenario} onChange={event => { const next = new URLSearchParams(search); if (event.target.value === "normal") next.delete("scenario"); else next.set("scenario", event.target.value); setSearch(next); }}>{["normal", "loading", "empty", "error", "forbidden", "not-found", "conflict", "unknown"].map(value => <option key={value} value={value}>{enumLabel("scenario", value)}</option>)}</Select></label>
        <Button variant="ghost" onClick={() => reset?.()}>{t("navigation.reset")}</Button>
      </div>
    </details>}
    {snapshot.notice && <Alert tone="warning">{t("error.configurationMismatch")}</Alert>}
    <ScenarioBoundary scenario={scenario}>{children}</ScenarioBoundary>
  </AuthenticatedLayout>;
}
function ScenarioBoundary({ scenario, children }: { scenario: string; children: ReactNode }) {
  const t = useTranslation();
  if (scenario === "loading") return <div aria-busy="true"><Alert>{t("navigation.loading")}</Alert></div>;
  if (scenario === "empty") return <EmptyState title={t("error.empty")} />;
  if (scenario === "forbidden") return <EmptyState title={t("error.forbidden")} />;
  if (scenario === "not-found") return <EmptyState title={t("error.notFound")} />;
  return <>{["error", "conflict", "unknown"].includes(scenario) && <Alert tone={scenario === "error" ? "danger" : "warning"}>{t(scenario === "conflict" ? "error.conflict" : scenario === "unknown" ? "error.uncertain" : "error.retry")}</Alert>}{children}</>;
}
