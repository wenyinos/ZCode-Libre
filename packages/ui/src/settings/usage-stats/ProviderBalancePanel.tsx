import { RefreshCcw } from "lucide-react";
import { useCallback } from "react";
import type {
  ProviderBalanceAmount,
  ProviderBalanceEntry,
  ProviderBalanceWindow,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useProviderBalance } from "@/hooks/useProviderBalance.js";

const WINDOW_LABEL_IDS: Record<ProviderBalanceWindow["name"], string> = {
  "5h": "settings.usage.balance.window.5h",
  weekly: "settings.usage.balance.window.weekly",
  monthly: "settings.usage.balance.window.monthly",
};

/** 把秒数转成"3 小时 12 分"这类短文案；小于一分钟直接给秒。 */
function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${Math.round(totalSeconds)}s`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatAmount(amount: ProviderBalanceAmount): string {
  // 余额通常很小，固定两位小数；整数金额去掉多余的 .00。
  const value = Number.isInteger(amount.total) ? String(amount.total) : amount.total.toFixed(2);
  return `${amount.currency} ${value}`;
}

function BalanceWindowRow({ window }: { window: ProviderBalanceWindow }) {
  const { intl } = useZCodeIntl();
  const used = window.usedPercent;
  // 用剩余量着色：越少越接近告警色，让"快用完了"一眼可见。
  const barClass =
    used >= 90 ? "bg-destructive" : used >= 70 ? "bg-warning" : "bg-primary";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-ui-base">
        <span className="text-foreground">
          {intl.formatMessage({ id: WINDOW_LABEL_IDS[window.name] })}
        </span>
        <span className="text-foreground-subtle">
          {intl.formatMessage(
            { id: "settings.usage.balance.usedPercent" },
            { percent: Math.round(used) },
          )}
          {window.resetInSec !== undefined
            ? ` · ${intl.formatMessage(
                { id: "settings.usage.balance.resetsIn" },
                { duration: formatDuration(window.resetInSec) },
              )}`
            : ""}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${used}%` }} />
      </div>
    </div>
  );
}

function BalanceEntryCard({ entry }: { entry: ProviderBalanceEntry }) {
  const { intl } = useZCodeIntl();

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-card-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-ui-base font-medium text-foreground">
          {entry.providerName}
        </span>
        <span className="shrink-0 text-ui-xs text-foreground-subtlest">{entry.vendor}</span>
      </div>

      {entry.error ? (
        <span className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.usage.balance.queryFailed" })}
        </span>
      ) : entry.windows ? (
        <div className="flex flex-col gap-3">
          {entry.windows.map((window) => (
            <BalanceWindowRow key={window.name} window={window} />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {(entry.balances ?? []).map((amount) => (
            <span key={amount.currency} className="text-ui-lg text-foreground">
              {formatAmount(amount)}
            </span>
          ))}
          {(entry.balances ?? [])
            .filter((amount) => amount.granted !== undefined || amount.toppedUp !== undefined)
            .map((amount) => (
              <span key={`${amount.currency}-detail`} className="text-ui-xs text-foreground-subtlest">
                {intl.formatMessage(
                  { id: "settings.usage.balance.breakdown" },
                  {
                    granted: amount.granted ?? 0,
                    toppedUp: amount.toppedUp ?? 0,
                  },
                )}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

export function ProviderBalancePanel() {
  const { intl } = useZCodeIntl();
  const { snapshot, loading, error, refresh } = useProviderBalance();
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const entries = snapshot?.entries ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-ui-lg font-medium text-foreground">
            {intl.formatMessage({ id: "settings.usage.balance.title" })}
          </span>
          <span className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.usage.balance.description" })}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={loading}
          onClick={handleRefresh}
        >
          <RefreshCcw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          {intl.formatMessage({ id: "settings.usage.balance.refresh" })}
        </Button>
      </div>

      {error ? (
        <span className="text-ui-base text-destructive">
          {intl.formatMessage({ id: "settings.usage.balance.loadFailed" })}
        </span>
      ) : null}

      {!loading && entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.usage.balance.empty" })}
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {entries.map((entry) => (
            <BalanceEntryCard key={entry.providerId} entry={entry} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
