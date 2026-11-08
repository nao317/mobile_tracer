import {
  Alert,
  EmptyState,
  PageHeader,
  Panel,
} from "../../components/ui/primitives";
import { canManage } from "./model";
import {
  CaseCreateScreen,
  CaseHeader,
  CaseScreen,
  CasesScreen,
  CaseTabs,
  DashboardScreen,
  RecordFormScreen,
  RecordScreen,
  VehicleFormScreen,
  VehicleScreen,
  VehiclesScreen,
} from "./core-screens";
import {
  AnswersScreen,
  CompareScreen,
  CorrectScreen,
  DisputesScreen,
  ExportScreen,
  PhotosScreen,
  ReceiptScreen,
  RecipientScreen,
  SharingScreen,
  SubmitScreen,
  TasksScreen,
  VehicleHistoryScreen,
  VerificationScreen,
} from "./workflow-screens";
import {
  AuditScreen,
  CatalogScreen,
  ConfigurationScreen,
  DeletionScreen,
  EnvironmentsScreen,
  ImportsScreen,
  OperationsScreen,
  OrganizationScreen,
  SupportAccessScreen,
  SupportScreen,
  UsageScreen,
} from "./management-screens";
import { coreScreens, type Screen } from "./screens";
import { useWorkspace } from "./workspace-context";
import { WorkspaceShell } from "./workspace-shell";
import { RouteTabs } from "./route-tabs";

export function WorkspaceView({ screen }: { screen: Screen }) {
  const { snapshot, mode, base } = useWorkspace();
  const item = screen.params.caseId
    ? snapshot.cases.find((c) => c.id === screen.params.caseId)
    : undefined;
  let content;
  if (mode === "live" && !coreScreens.has(screen.key))
    content = (
      <Panel>
        <Alert>
          この機能は現在利用できません。利用可能になった後、この画面から操作できます。
        </Alert>
      </Panel>
    );
  else if (screen.params.caseId && !item)
    content = <EmptyState title="案件が見つかりません" />;
  else if (
    (screen.key.startsWith("operations") ||
      [
        "organization",
        "configuration",
        "support",
        "deletion",
        "environments",
        "imports",
        "support-access",
      ].includes(screen.key)) &&
    !canManage(snapshot.context)
  )
    content = (
      <EmptyState title="管理権限が必要です">
        所属と担当範囲を確認してください。
      </EmptyState>
    );
  else {
    switch (screen.key) {
      case "dashboard":
        content = <DashboardScreen />;
        break;
      case "vehicles":
        content = <VehiclesScreen />;
        break;
      case "vehicle-new":
        content = <VehicleFormScreen />;
        break;
      case "vehicle":
        content = <VehicleScreen vehicleId={screen.params.vehicleId} />;
        break;
      case "vehicle-history":
        content = <VehicleHistoryScreen vehicleId={screen.params.vehicleId} />;
        break;
      case "cases":
        content = <CasesScreen />;
        break;
      case "case-new":
        content = <CaseCreateScreen />;
        break;
      case "case":
        content = <CaseScreen item={item!} />;
        break;
      case "record-new":
        content = <RecordFormScreen item={item!} />;
        break;
      case "record-edit":
        content = (
          <RecordFormScreen item={item!} recordId={screen.params.recordId} />
        );
        break;
      case "record":
        content = (
          <RecordScreen item={item!} recordId={screen.params.recordId} />
        );
        break;
      case "photos":
        content = (
          <PhotosScreen item={item!} recordId={screen.params.recordId} />
        );
        break;
      case "submit":
        content = (
          <SubmitScreen item={item!} recordId={screen.params.recordId} />
        );
        break;
      case "correct":
        content = (
          <CorrectScreen item={item!} recordId={screen.params.recordId} />
        );
        break;
      case "compare":
        content = <CompareScreen item={item!} />;
        break;
      case "answers":
        content = <AnswersScreen item={item!} />;
        break;
      case "disputes":
        content = <DisputesScreen item={item!} />;
        break;
      case "sharing":
        content = <SharingScreen item={item!} />;
        break;
      case "verification":
        content = <VerificationScreen item={item!} />;
        break;
      case "exports":
        content = <ExportScreen item={item!} />;
        break;
      case "recipient":
        content = <RecipientScreen shareId={screen.params.shareId} />;
        break;
      case "receipt":
        content = <ReceiptScreen answerId={screen.params.answerId} />;
        break;
      case "tasks":
        content = <TasksScreen />;
        break;
      case "organization":
        content = <OrganizationScreen />;
        break;
      case "configuration":
        content = <ConfigurationScreen />;
        break;
      case "usage":
        content = <UsageScreen />;
        break;
      case "audit":
        content = <AuditScreen />;
        break;
      case "support":
        content = <SupportScreen />;
        break;
      case "deletion":
        content = <DeletionScreen />;
        break;
      case "environments":
        content = <EnvironmentsScreen />;
        break;
      case "imports":
        content = <ImportsScreen />;
        break;
      case "operations":
        content = <OperationsScreen />;
        break;
      case "support-access":
        content = <SupportAccessScreen />;
        break;
      case "catalog":
        content = <CatalogScreen />;
        break;
    }
  }
  const settings = [
    ["organization", "店舗・担当者"],
    ["configuration", "構成版"],
    ["usage", "利用状況"],
    ["audit", "監査履歴"],
    ["support", "サポート許可"],
    ["deletion", "削除申請"],
  ];
  const operations = [
    ["environments", "利用環境"],
    ["imports", "CSV取込"],
    ["status", "運用状況"],
    ["support", "サポートアクセス"],
  ];
  return (
    <WorkspaceShell screen={screen}>
      {item && (
        <>
          <CaseHeader item={item} />
          <CaseTabs caseId={item.id} section={screen.key} />
        </>
      )}
      {!item &&
        ![
          "dashboard",
          "vehicles",
          "vehicle",
          "vehicle-new",
          "cases",
          "case-new",
          "catalog",
        ].includes(screen.key) && <PageHeader title={screen.title} />}
      {[
        "organization",
        "configuration",
        "usage",
        "audit",
        "support",
        "deletion",
      ].includes(screen.key) && (
        <RouteTabs
          label="顧客管理の操作"
          items={settings.map(([path, label]) => ({
            to: `${base}/settings/${path}`,
            label,
          }))}
          activeTo={`${base}/settings/${screen.key}`}
        />
      )}
      {["environments", "imports", "operations", "support-access"].includes(
        screen.key,
      ) && (
        <RouteTabs
          label="提供側運用の操作"
          items={operations.map(([path, label]) => ({
            to: `${base}/operations/${path}`,
            label,
          }))}
          activeTo={`${base}/operations/${screen.key === "operations" ? "status" : screen.key === "support-access" ? "support" : screen.key}`}
        />
      )}
      <div
        className="ui-stack"
        key={`${screen.key}:${Object.values(screen.params).join(":")}`}
      >
        {content}
      </div>
    </WorkspaceShell>
  );
}
