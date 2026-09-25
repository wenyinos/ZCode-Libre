import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";
import {
  CodingPlanUsagePanel,
  type CodingPlanUsageSource,
} from "@/settings/usage-stats/CodingPlanUsagePanel.js";

export type UsageStatsSectionTab = "app" | "codingPlan" | `codingPlan:${string}`;

export function UsageStatsSection({
  activeTab,
  providerSourcesLoading,
  workspaceIdentity,
  workspacePath,
  selectedCodingPlanSource,
}: {
  activeTab: UsageStatsSectionTab;
  providerSourcesLoading: boolean;
  workspaceIdentity?: string;
  workspacePath?: string;
  selectedCodingPlanSource?: CodingPlanUsageSource | null;
}) {
  if (activeTab === "app") {
    return <AppUsagePanel />;
  }

  // 套餐额度已独立成「个人套餐」分区：这里的页签只留上游原有的应用用量与套餐权益。
  return (
    <CodingPlanUsagePanel
      loadingSources={providerSourcesLoading}
      workspaceIdentity={workspaceIdentity}
      workspacePath={workspacePath}
      selectedSource={selectedCodingPlanSource}
    />
  );
}
