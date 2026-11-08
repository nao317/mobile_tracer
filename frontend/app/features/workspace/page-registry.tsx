import type { ReactNode } from "react";
import type { BusinessCase } from "./model";
import type { Screen, ScreenKey } from "./screens";
import * as core from "./core-screens";
import * as workflow from "./workflow-screens";
import * as management from "./management-screens";

type PageContext = { screen: Screen; item?: BusinessCase };
type Page = (context: PageContext) => ReactNode;
// Route resolution and access checks happen before this rendering registry.
// Keeping implementations in feature pages also makes missing screens a type error.
export const workspacePages = {
  dashboard: () => <core.DashboardScreen />,
  vehicles: () => <core.VehiclesScreen />,
  "vehicle-new": () => <core.VehicleFormScreen />,
  vehicle: ({ screen }) => <core.VehicleScreen vehicleId={screen.params.vehicleId} />,
  "vehicle-history": ({ screen }) => <workflow.VehicleHistoryScreen vehicleId={screen.params.vehicleId} />,
  cases: () => <core.CasesScreen />,
  "case-new": () => <core.CaseCreateScreen />,
  case: ({ item }) => <core.CaseScreen item={item!} />,
  "case-records": ({ item }) => <core.CaseRecordsScreen item={item!} />,
  "case-participants": ({ item }) => <core.CaseParticipantsScreen item={item!} />,
  "case-manage": ({ item }) => <core.CaseManageScreen item={item!} />,
  "record-new": ({ item }) => <core.RecordFormScreen item={item!} />,
  "record-edit": ({ item, screen }) => <core.RecordFormScreen item={item!} recordId={screen.params.recordId} />,
  record: ({ item, screen }) => <core.RecordScreen item={item!} recordId={screen.params.recordId} />,
  "record-history": ({ item, screen }) => <core.RecordHistoryScreen item={item!} recordId={screen.params.recordId} />,
  photos: ({ item, screen }) => <workflow.PhotosScreen item={item!} recordId={screen.params.recordId} />,
  submit: ({ item, screen }) => <workflow.SubmitScreen item={item!} recordId={screen.params.recordId} />,
  correct: ({ item, screen }) => <workflow.CorrectScreen item={item!} recordId={screen.params.recordId} />,
  compare: ({ item }) => <workflow.CompareScreen item={item!} />,
  answers: ({ item }) => <workflow.AnswersScreen item={item!} />,
  disputes: ({ item }) => <workflow.DisputesScreen item={item!} />,
  sharing: ({ item }) => <workflow.SharingScreen item={item!} />,
  verification: ({ item }) => <workflow.VerificationScreen item={item!} />,
  exports: ({ item }) => <workflow.ExportScreen item={item!} />,
  recipient: ({ screen }) => <workflow.RecipientScreen shareId={screen.params.shareId} />,
  receipt: ({ screen }) => <workflow.ReceiptScreen answerId={screen.params.answerId} />,
  tasks: () => <workflow.TasksScreen />,
  organization: () => <management.OrganizationScreen />,
  configuration: () => <management.ConfigurationScreen />,
  usage: () => <management.UsageScreen />,
  audit: () => <management.AuditScreen />,
  support: () => <management.SupportScreen />,
  deletion: () => <management.DeletionScreen />,
  environments: () => <management.EnvironmentsScreen />,
  imports: () => <management.ImportsScreen />,
  operations: () => <management.OperationsScreen />,
  "support-access": () => <management.SupportAccessScreen />,
  catalog: () => <management.CatalogScreen />,
} satisfies Record<ScreenKey, Page>;
