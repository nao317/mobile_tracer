import { useSearchParams } from "react-router";
import { Pagination } from "../../../components/molecules/pagination";
import { Badge, EmptyState, Panel, TextField } from "../../../components/ui/primitives";
import uiStyles from "../../../components/ui/ui.module.css";
import { clientPage } from "../../management/navigation";
import { canManage, type BusinessCase } from "../model";
import { CommandForm, CommandSubmit } from "../command-form";
import { useWorkspace } from "../workspace-context";
import { CoreBackLink, CoreLink } from "./navigation";
import { useCoreI18n } from "./core-messages";

export function CaseParticipantsScreen({ item }: { item: BusinessCase; }) {
  const { c, t } = useCoreI18n();
  const { snapshot, mode, base } = useWorkspace();
  const [search] = useSearchParams();
  const path = `${base}/cases/${item.id}/participants`;
  const create = search.get("view") === "new";
  const allowed = canManage(snapshot.context, item.store_id);
  const participants = snapshot.workflow?.management.filter(participant => participant.kind === `participant:${item.id}`) ?? [];
  const page = clientPage(participants, search.get("participantsPage"));

  if (mode !== "preview") return <EmptyState title={c("workspace.participant.unavailable")} />;
  if (create && !allowed) return <EmptyState title={t("error.forbidden")} />;
  return <>
    <CoreBackLink to={create ? path : `${base}/cases/${item.id}`} />
    {create ? <Panel title={c("workspace.participant.add")}>
      <CommandForm intent="manage" hidden={{ kind: `participant:${item.id}`, status: "有効" }} guard>
        <TextField id="participant-name" name="name" label={c("workspace.participant.name")} required />
        <TextField id="participant-detail" name="detail" label={c("workspace.participant.rolePeriod")} placeholder={c("workspace.participant.placeholder")} required />
        <CommandSubmit>{c("workspace.participant.add")}</CommandSubmit>
      </CommandForm>
    </Panel> : <Panel title={c("workspace.participant.title")} actions={allowed &&
      <CoreLink fromHere to={`${path}?view=new`} className={uiStyles["ui-link-button"]}>{c("workspace.participant.add")}</CoreLink>
    }>
      {page.data.length ? <ul className={uiStyles["ui-stack"]}>{page.data.map(participant => <li key={participant.id}>
        <strong>{participant.name}</strong> / {participant.detail} <Badge>{participant.status === "有効" ? c("workspace.participant.active") : participant.status}</Badge>
      </li>)}</ul> : <EmptyState title={t("error.empty")} />}
      <Pagination pagination={page.pagination} pageKey="participantsPage" />
    </Panel>}
    <p className={uiStyles["ui-hint"]}>{c("workspace.participant.notice")}</p>
  </>;
}
