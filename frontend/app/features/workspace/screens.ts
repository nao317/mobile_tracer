export const screenDefinitions = [
  { key: "dashboard", path: "", title: "ホーム", group: "業務" },
  { key: "tasks", path: "tasks", title: "未対応一覧", group: "業務" },
  { key: "vehicles", path: "vehicles", title: "車両", group: "業務" },
  {
    key: "vehicle-new",
    path: "vehicles/new",
    title: "車両登録",
    group: "業務",
  },
  {
    key: "vehicle",
    path: "vehicles/:vehicleId",
    title: "車両詳細",
    group: "業務",
  },
  {
    key: "vehicle-history",
    path: "vehicles/:vehicleId/history",
    title: "識別情報・所有者履歴",
    group: "業務",
  },
  { key: "cases", path: "cases", title: "案件", group: "業務" },
  { key: "case-new", path: "cases/new", title: "案件作成", group: "業務" },
  { key: "case", path: "cases/:caseId", title: "案件詳細", group: "業務" },
  {
    key: "record-new",
    path: "cases/:caseId/records/new",
    title: "記録の作成",
    group: "記録",
  },
  {
    key: "record",
    path: "cases/:caseId/records/:recordId",
    title: "記録・版履歴",
    group: "記録",
  },
  {
    key: "record-edit",
    path: "cases/:caseId/records/:recordId/edit",
    title: "下書き編集",
    group: "記録",
  },
  {
    key: "photos",
    path: "cases/:caseId/records/:recordId/photos",
    title: "撮影・点検",
    group: "記録",
  },
  {
    key: "submit",
    path: "cases/:caseId/records/:recordId/submit",
    title: "提出前確認",
    group: "記録",
  },
  {
    key: "correct",
    path: "cases/:caseId/records/:recordId/correct",
    title: "訂正・補足",
    group: "記録",
  },
  {
    key: "compare",
    path: "cases/:caseId/compare",
    title: "記録の比較",
    group: "確認・共有",
  },
  {
    key: "answers",
    path: "cases/:caseId/answers",
    title: "確認依頼・回答",
    group: "確認・共有",
  },
  {
    key: "disputes",
    path: "cases/:caseId/disputes",
    title: "異議・再確認",
    group: "確認・共有",
  },
  {
    key: "sharing",
    path: "cases/:caseId/sharing",
    title: "共有",
    group: "確認・共有",
  },
  {
    key: "verification",
    path: "cases/:caseId/verification",
    title: "登録・検証",
    group: "確認・共有",
  },
  {
    key: "exports",
    path: "cases/:caseId/exports",
    title: "帳票・データ出力",
    group: "確認・共有",
  },
  {
    key: "recipient",
    path: "recipient/:shareId",
    title: "共有された記録",
    group: "利用者",
  },
  {
    key: "receipt",
    path: "receipts/:answerId",
    title: "本人控え",
    group: "利用者",
  },
  {
    key: "organization",
    path: "settings/organization",
    title: "店舗・担当者・権限",
    group: "顧客管理",
  },
  {
    key: "configuration",
    path: "settings/configuration",
    title: "設定・構成版",
    group: "顧客管理",
  },
  {
    key: "usage",
    path: "settings/usage",
    title: "利用状況",
    group: "顧客管理",
  },
  {
    key: "audit",
    path: "settings/audit",
    title: "監査履歴",
    group: "顧客管理",
  },
  {
    key: "support",
    path: "settings/support",
    title: "サポート許可",
    group: "顧客管理",
  },
  {
    key: "deletion",
    path: "settings/deletion",
    title: "削除申請",
    group: "顧客管理",
  },
  {
    key: "environments",
    path: "operations/environments",
    title: "利用環境・テンプレート",
    group: "提供側運用",
  },
  {
    key: "imports",
    path: "operations/imports",
    title: "CSV取込",
    group: "提供側運用",
  },
  {
    key: "operations",
    path: "operations/status",
    title: "運用状況",
    group: "提供側運用",
  },
  {
    key: "support-access",
    path: "operations/support",
    title: "サポートアクセス",
    group: "提供側運用",
  },
  { key: "catalog", path: "screens", title: "画面一覧", group: "レビュー" },
] as const;
export type ScreenKey = (typeof screenDefinitions)[number]["key"];
export type Screen = {
  key: ScreenKey;
  title: string;
  params: Record<string, string>;
};
export function resolveScreen(path: string): Screen | null {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  for (const screen of screenDefinitions) {
    const pattern = screen.path.split("/");
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (
      pattern.every((part, i) => {
        if (part.startsWith(":")) {
          params[part.slice(1)] = parts[i];
          return !!parts[i];
        }
        return part === parts[i];
      })
    )
      return { key: screen.key, title: screen.title, params };
  }
  return null;
}
export const coreScreens = new Set<ScreenKey>([
  "dashboard",
  "vehicles",
  "vehicle-new",
  "vehicle",
  "cases",
  "case-new",
  "case",
  "record-new",
  "record",
  "record-edit",
]);
