import { useState } from "react";
import { useI18n } from "../../../components/ui/display-settings";
import { Pagination } from "../../../components/molecules/pagination";
import { Button, EmptyState, Field, Panel, Textarea } from "../../../components/ui/primitives";
import { CommandForm, CommandSubmit } from "../command-form";
import { useWorkspace } from "../workspace-context";
import { BackLink, ItemHistory, ManagementList, ViewLinks, styles, ui, useClientPage, useView } from "./common";

export type CsvRow = {
  line: number;
  model: string;
  identifier: string;
  error: string;
  errorCode?: "header" | "invalid" | "duplicate";
};
/** Validate every row; display pagination is independent of validation. */
export function inspectCsv(source: string): CsvRow[] {
  const lines = source.trim().split(/\r?\n/);
  if (lines[0] !== "model_name,plate_number") return [{
    line: 1, model: "", identifier: "", errorCode: "header",
    error: "ヘッダーは model_name,plate_number を指定してください。",
  }];
  const seen = new Set<string>();
  return lines.slice(1).map((line, index) => {
    const columns = line.split(","), [model = "", identifier = ""] = columns;
    const errorCode = columns.length !== 2 || !model.trim() || !identifier.trim()
      ? "invalid" : seen.has(identifier) ? "duplicate" : undefined;
    const error = errorCode === "invalid" ? "車種名・ナンバーを確認してください。"
      : errorCode === "duplicate" ? "CSV内に同じナンバーがあります。" : "";
    seen.add(identifier);
    return { line: index + 2, model, identifier, error, ...(errorCode ? { errorCode } : {}) };
  });
}
function CsvResults({ rows }: { rows: CsvRow[] }) {
  const { t } = useI18n();
  const page = useClientPage(rows, "csvPage");
  const valid = rows.filter((row) => !row.error).length;
  return <Panel title={t("previewManagement.csvResults")}>
    <table className={`${ui["ui-table"]} ${ui["ui-table--responsive"]}`}><thead><tr>
      <th>{t("previewManagement.row")}</th><th>{t("previewManagement.model")}</th><th>{t("previewManagement.plate")}</th><th>{t("previewManagement.result")}</th>
    </tr></thead><tbody>{page.items.map((row) => <tr key={row.line}>
      <td data-label={t("previewManagement.row")}>{row.line}</td><td data-label={t("previewManagement.model")}>{row.model}</td><td data-label={t("previewManagement.plate")}>{row.identifier}</td>
      <td data-label={t("previewManagement.result")}>{t(row.errorCode === "header" ? "previewManagement.csvHeader" : row.errorCode === "invalid" ? "previewManagement.csvInvalid" : row.errorCode === "duplicate" ? "previewManagement.csvDuplicate" : "previewManagement.csvReady")}</td>
    </tr>)}</tbody></table>
    <Pagination pagination={page.pagination} pageKey="csvPage" />
    <CommandForm intent="manage" hidden={{ kind: "import", name: "車両CSVの取込", detail: `${valid}件正常 / ${rows.length - valid}件除外`, status: "確認済み・取込結果サンプル" }}>
      <label className={styles["workspace-check"]}><input type="checkbox" required />{t("previewManagement.csvConfirm")}</label>
      <CommandSubmit>{t("previewManagement.csvSave")}</CommandSubmit>
    </CommandForm>
  </Panel>;
}
export function ImportsScreen() {
  const { snapshot } = useWorkspace();
  const { t } = useI18n();
  const { view, href, search, setSearch } = useView("history");
  const [source, setSource] = useState(() => t("previewManagement.csvSample"));
  const [preview, setPreview] = useState<CsvRow[] | null>(null);
  const imports = snapshot.workflow!.management.filter((item) => item.kind === "import");
  const selected = imports.find((item) => item.id === search.get("item"));
  const links = [
    { to: href("history"), label: t("previewManagement.importHistory") },
    { to: href("new"), label: t("previewManagement.importCreate") },
    { to: href("preview"), label: t("previewManagement.csvResults") },
  ];
  function trial() {
    setPreview(inspectCsv(source));
    const next = new URLSearchParams(search);
    next.set("view", "preview");
    next.delete("csvPage");
    next.delete("item");
    setSearch(next);
  }
  let content;
  if (view === "new") content = <Panel title={t("previewManagement.importCreate")}>
    <p className={ui["ui-muted"]}>{t("previewManagement.importNotice")}</p>
    <Field id="csv-source" label={t("previewManagement.csvSource")}><Textarea id="csv-source" rows={6} value={source} onChange={(event) => { setSource(event.target.value); setPreview(null); }} /></Field>
    <Button onClick={trial}>{t("previewManagement.csvRun")}</Button>
  </Panel>;
  else if (view === "preview") content = preview ? <CsvResults rows={preview} /> : <EmptyState title={t("previewManagement.empty")} actions={<BackLink to={href("new")} />} />;
  else if (view === "detail") content = selected ? <><BackLink to={href("history")} /><Panel title={t("previewManagement.importHistory")}><strong>{selected.name}</strong><p>{selected.detail}</p></Panel><ItemHistory item={selected} /></> : <EmptyState title={t("previewManagement.missing")} />;
  else content = <Panel title={t("previewManagement.importHistory")}><ManagementList items={imports} detailView="detail" /></Panel>;
  return <><ViewLinks items={links} selected={href(view)} />{content}</>;
}
