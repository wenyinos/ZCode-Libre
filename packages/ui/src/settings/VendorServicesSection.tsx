import { useCallback } from "react";
import type { AppSettings } from "@zcode/shared";
import { LIBRE_VENDOR_SERVICES, type VendorServiceId } from "@zcode/shared";
import { Switch } from "@/components/ui/switch.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsBadge, SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { logger } from "@/logger.js";

/**
 * 厂商服务开关。
 *
 * 默认值来自 `libre-features.ts` 的分支策略（全部关闭），这里的开关是用户级覆盖。
 * 服务端消费点在每次读取设置时刷新进程内快照，因此改完开关后新建的请求就按新值走；
 * 已经在跑的连接不会被打断，会话分享需要重启后生效。
 */
type VendorServiceField =
  | "vendorServiceConversationShareEnabled"
  | "vendorServiceFeedbackEnabled"
  | "vendorServiceCodingPlanPurchaseEnabled";

const TOGGLES: ReadonlyArray<{
  field: VendorServiceField;
  /** 对应的分支策略项，用于取默认值——不要在组件里另写一份默认值。 */
  service: VendorServiceId;
  labelId: string;
  descriptionId: string;
  restartHint?: boolean;
}> = [
  {
    field: "vendorServiceFeedbackEnabled",
    service: "feedback",
    labelId: "settings.vendorServices.feedback",
    descriptionId: "settings.vendorServices.feedback.description",
  },
  {
    field: "vendorServiceConversationShareEnabled",
    service: "conversationShare",
    labelId: "settings.vendorServices.conversationShare",
    descriptionId: "settings.vendorServices.conversationShare.description",
    restartHint: true,
  },
  {
    field: "vendorServiceCodingPlanPurchaseEnabled",
    service: "codingPlanPurchase",
    labelId: "settings.vendorServices.codingPlanPurchase",
    descriptionId: "settings.vendorServices.codingPlanPurchase.description",
  },
];

function readEnabled(settings: AppSettings | null, service: VendorServiceId, field: VendorServiceField): boolean {
  const value = settings?.[field];
  // 未写入过时回到 libre-features.ts 的分支默认值，避免这里再维护一份默认值而分叉。
  return typeof value === "boolean" ? value : LIBRE_VENDOR_SERVICES[service];
}

function GroupHeading({ titleId, descriptionId }: { titleId: string; descriptionId: string }) {
  const { intl } = useZCodeIntl();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ui-lg font-medium text-foreground">
        {intl.formatMessage({ id: titleId })}
      </span>
      <span className="text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: descriptionId })}
      </span>
    </div>
  );
}

export function VendorServicesSection() {
  const { intl } = useZCodeIntl();
  const { settings, update } = useSettings();

  const handleChange = useCallback(
    async (field: VendorServiceField, enabled: boolean) => {
      try {
        await update({ [field]: enabled } as Partial<AppSettings>);
      } catch (error) {
        logger.error("[vendor-services] 保存厂商服务开关失败", error);
      }
    },
    [update],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <GroupHeading
          titleId="settings.vendorServices.title"
          descriptionId="settings.vendorServices.description"
        />
        <SettingsGroupCard>
          {TOGGLES.map((toggle) => (
            <SettingsRow
              key={toggle.field}
              label={intl.formatMessage({ id: toggle.labelId })}
              description={
                toggle.restartHint
                  ? `${intl.formatMessage({ id: toggle.descriptionId })}${intl.formatMessage({
                      id: "settings.vendorServices.restartHint",
                    })}`
                  : intl.formatMessage({ id: toggle.descriptionId })
              }
              control={
                <Switch
                  checked={readEnabled(settings, toggle.service, toggle.field)}
                  onCheckedChange={(checked) => void handleChange(toggle.field, checked === true)}
                />
              }
            />
          ))}
        </SettingsGroupCard>
      </div>

      <div className="flex flex-col gap-3">
        <GroupHeading
          titleId="settings.vendorServices.fixedTitle"
          descriptionId="settings.vendorServices.fixedDescription"
        />
        <SettingsGroupCard>
          <SettingsRow
            label={intl.formatMessage({ id: "settings.vendorServices.signIn" })}
            description={intl.formatMessage({ id: "settings.vendorServices.signIn.description" })}
            control={<SettingsBadge>{intl.formatMessage({ id: "settings.vendorServices.off" })}</SettingsBadge>}
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.vendorServices.pluginMarketplace" })}
            description={intl.formatMessage({
              id: "settings.vendorServices.pluginMarketplace.description",
            })}
            control={<SettingsBadge>{intl.formatMessage({ id: "settings.vendorServices.off" })}</SettingsBadge>}
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.vendorServices.telemetry" })}
            description={intl.formatMessage({ id: "settings.vendorServices.telemetry.description" })}
            control={<SettingsBadge>{intl.formatMessage({ id: "settings.vendorServices.off" })}</SettingsBadge>}
          />
        </SettingsGroupCard>
      </div>
    </div>
  );
}
