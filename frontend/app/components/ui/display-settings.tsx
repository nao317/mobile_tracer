import { createContext, use, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

type Language = "ja" | "en";
type Theme = "light" | "dark";
const labels: Record<string, string> = {
  ホーム: "Dashboard",
  未対応一覧: "Tasks",
  車両: "Vehicles",
  車両登録: "Add vehicle",
  車両詳細: "Vehicle details",
  案件: "Cases",
  案件作成: "Create case",
  案件詳細: "Case details",
  顧客管理: "Company settings",
  提供側運用: "Operations",
  全画面を確認: "All screens",
  アカウント: "Account",
  ワークスペース: "Workspace",
  サンプル企業: "Sample company",
  業務ワークスペース: "Business workspace",
  "UIプレビュー": "UI preview",
  業務環境: "Business workspace",
  概要: "Overview",
  ユーザー管理: "Users",
  "企業・プロファイル管理": "Companies and profiles",
  申請の一元管理: "Applications",
  "自分の申請・企業": "My applications and companies",
  システム管理: "System administration",
  表示設定: "Display settings",
  本文へ移動: "Skip to content",
  データがありません: "No data available",
  ログイン: "Sign in",
  新規登録: "Sign up",
  検索: "Search",
  クリア: "Clear",
  保存: "Save",
  キャンセル: "Cancel",
  戻る: "Back",
  次へ: "Next",
  確認: "Review",
  有効: "Active",
  停止: "Suspended",
  企業: "Company",
  ユーザー: "User",
  表示名: "Display name",
  メールアドレス: "Email address",
  状態: "Status",
  作成日時: "Created",
  操作: "Actions",
  申請履歴: "Application history",
  承認待ち: "Pending",
  承認済み: "Approved",
  拒否: "Rejected",
  業者ユーザー: "Business user",
  一般ユーザー: "General user",
  店舗: "Stores",
  記録の作成: "Create record",
  "記録・版履歴": "Record history",
  下書き編集: "Edit draft",
  "撮影・点検": "Photos and inspection",
  提出前確認: "Review submission",
  "訂正・補足": "Corrections",
  記録の比較: "Compare records",
  "確認依頼・回答": "Requests and responses",
  "異議・再確認": "Objections and review",
  共有: "Sharing",
  "登録・検証": "Registration and verification",
  "帳票・データ出力": "Reports and exports",
  共有された記録: "Shared record",
  本人控え: "Your copy",
  "店舗・担当者・権限": "Stores and permissions",
  "識別情報・所有者履歴": "Identifiers and ownership history",
  審査状態: "Review status",
  申請種別: "Application type",
  審査理由: "Review reason",
  該当する申請はありません: "No matching applications",
  ユーザー区分: "Account type",
  利用状態: "Account status",
  ユーザー一覧: "Users",
  区分: "Type",
  メール確認: "Email verification",
  ユーザーが見つかりません: "No users found",
  所属する企業: "Companies",
  所属する企業はありません: "No companies",
  業者ユーザーへの変更申請: "Apply for a business account",
  業者としての表示名: "Business display name",
  変更を申請する理由: "Reason for applying",
  "企業・プロファイルの作成申請": "Apply to create a company and profile",
  自分の申請履歴: "My applications",
  申請履歴はありません: "No applications",
  企業の状態: "Company status",
  企業一覧: "Companies",
  正式名称: "Legal name",
  企業が見つかりません: "No companies found",
  所属させる業者ユーザーを探す: "Find business users",
  "業者の名前・メールアドレス": "Business user name or email",
  企業の表示名: "Company display name",
  正式な企業名: "Legal company name",
  "企業・サービスの紹介": "About the company and services",
  Webサイト: "Website",
  電話番号: "Phone number",
  住所: "Address",
  企業の連絡先メール: "Company contact email",
  ページ切り替え: "Pagination",
  メインナビゲーション: "Main navigation",
  表示状態: "Display state",
  案件がありません: "No cases",
  "車両・案件": "Vehicle or case",
  業態: "Business type",
  業務段階: "Stage",
  進行中の案件: "Cases in progress",
  記録をはじめる: "Start a record",
  確認が必要なこと: "Needs attention",
  案件の状態: "Case status",
  車両一覧: "Vehicles",
  ナンバー: "Registration number",
  識別情報: "Identifiers",
  登録日時: "Registered",
  車両が見つかりません: "No vehicles found",
  企業管理者の権限が必要です: "Company administrator access required",
  車種名: "Vehicle model",
  識別情報の種類: "Identifier type",
  表示するデータがありません: "No data available",
  表示する権限がありません: "You do not have permission",
  対象が見つかりません: "Not found",
  保存する: "Save",
  ユーザー情報を保存: "Save user",
  企業情報を保存: "Save company",
  承認する: "Approve",
  拒否する: "Reject",
  プロファイル変更を申請: "Request profile change",
  初期状態に戻す: "Reset preview",
  "今日の業務と、確認が必要な記録をまとめて確認できます。":
    "Review today's work and records that need attention.",
  "この操作を行う権限がありません。":
    "You do not have permission for this action.",
};
type Settings = {
  language: Language;
  theme: Theme;
  setLanguage: (v: Language) => void;
  setTheme: (v: Theme) => void;
};
const SettingsContext = createContext<Settings>({
  language: "ja",
  theme: "light",
  setLanguage: () => {},
  setTheme: () => {},
});
export function DisplaySettingsProvider({
  children,
  initialLanguage,
  initialTheme,
}: {
  children: ReactNode;
  initialLanguage: Language;
  initialTheme: Theme;
}) {
  const [language, updateLanguage] = useState(initialLanguage),
    [theme, updateTheme] = useState(initialTheme);
  const save = (key: string, value: string) => {
    document.cookie = `${key}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  };
  return (
    <SettingsContext
      value={{
        language,
        theme,
        setLanguage: (value) => {
          updateLanguage(value);
          save("mt_locale", value);
        },
        setTheme: (value) => {
          updateTheme(value);
          save("mt_theme", value);
        },
      }}
    >
      {children}
    </SettingsContext>
  );
}
export function useDisplaySettings() {
  return use(SettingsContext);
}
export function useTranslation() {
  const { language } = useDisplaySettings();
  return (value: string) =>
    language === "en" ? (labels[value] ?? value) : value;
}
export function DisplayControls() {
  const { language, theme, setLanguage, setTheme } = useDisplaySettings();
  return (
    <div
      className="global-display-controls"
      role="group"
      aria-label={language === "ja" ? "表示設定" : "Display settings"}
    >
      <button
        className="global-display-button"
        type="button"
        lang={language === "ja" ? "en" : "ja"}
        aria-label={language === "ja" ? "English" : "日本語"}
        onClick={() => setLanguage(language === "ja" ? "en" : "ja")}
      >
        {language === "ja" ? "EN" : "JA"}
      </button>
      <button
        className="global-display-button"
        type="button"
        aria-label={
          language === "ja"
            ? theme === "light"
              ? "ダークテーマに切り替え"
              : "ライトテーマに切り替え"
            : theme === "light"
              ? "Switch to dark theme"
              : "Switch to light theme"
        }
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      >
        {theme === "light" ? (
          <Moon size={19} aria-hidden="true" />
        ) : (
          <Sun size={19} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
export function BrandMark() {
  return (
    <span
      className="workspace-logo-mark"
      translate="no"
      aria-label="Mobile Tracer"
    >
      MT
    </span>
  );
}
