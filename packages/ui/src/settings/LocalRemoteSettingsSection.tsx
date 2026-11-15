import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type {
  WebRemoteControlLocalAddress,
  WebRemoteControlLocalState,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  SettingsGroupCard,
  SettingsRow,
} from "@/settings/SettingsPageParts.js";

function AddressKindLabel({
  kind,
}: {
  kind: WebRemoteControlLocalAddress["kind"];
}) {
  const { intl } = useZCodeIntl();
  return intl.formatMessage({
    id: `settings.localRemote.address.kind.${kind}`,
  });
}

/**
 * 设置页「局域网远控」分区。
 *
 * 只负责配置：开关、二维码地址、当前 relay 状态。远控本身仍从主界面的
 * 「移动端远程控制」按钮启动，避免设置页与远控 runtime 各维护一套生命周期。
 */
export function LocalRemoteSettingsSection() {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const [state, setState] = useState<WebRemoteControlLocalState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await platform.getWebRemoteControlLocalState());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [platform]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (operation: () => Promise<WebRemoteControlLocalState>) => {
      setPending(true);
      try {
        setState(await operation());
        setError(null);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        logger.warn("[LocalRemoteSettings] update failed", message);
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const enabled = state?.enabled ?? false;
  const addresses = state?.addresses ?? [];
  const message = (id: string) => intl.formatMessage({ id });

  return (
    <div className="min-w-0 space-y-6">
      <SettingsGroupCard>
        <SettingsRow
          label={message("settings.localRemote.status.label")}
          description={
            state?.running
              ? message("settings.localRemote.status.running")
              : message("settings.localRemote.status.stopped")
          }
          control={
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void refresh()}
            >
              {pending ? (
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCw className="size-4" aria-hidden="true" />
              )}
              {message("settings.localRemote.refresh")}
            </Button>
          }
          detail={
            state?.origin ? (
              <div className="space-y-1 text-ui-sm text-foreground-subtle">
                <div>
                  {message("settings.localRemote.origin")}:{" "}
                  <span className="select-all">{state.origin}</span>
                </div>
                {state.pairCode ? (
                  <div>
                    {message("settings.localRemote.pairCode")}:{" "}
                    <span className="select-all font-mono">
                      {state.pairCode}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null
          }
        />
      </SettingsGroupCard>

      <SettingsGroupCard>
        <SettingsRow
          label={message("settings.localRemote.address.title")}
          description={message("settings.localRemote.address.description")}
          control={<span />}
          controlLayout="wide"
          detail={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={state?.preferredAddress ? "outline" : "default"}
                disabled={pending || !enabled}
                onClick={() =>
                  void run(() => platform.setWebRemoteControlLocalAddress(null))
                }
              >
                {message("settings.localRemote.address.auto")}
              </Button>
              {addresses.map((item) => (
                <Button
                  key={`${item.interfaceName}:${item.address}`}
                  type="button"
                  size="sm"
                  variant={
                    state?.preferredAddress === item.address
                      ? "default"
                      : "outline"
                  }
                  disabled={pending || !enabled}
                  onClick={() =>
                    void run(() =>
                      platform.setWebRemoteControlLocalAddress(item.address),
                    )
                  }
                >
                  {item.address}
                  <span className="ml-2 text-ui-sm text-foreground-subtle">
                    {item.interfaceName} · <AddressKindLabel kind={item.kind} />
                  </span>
                </Button>
              ))}
              {addresses.length === 0 ? (
                <span className="text-ui-sm text-foreground-subtle">
                  {message("settings.localRemote.address.none")}
                </span>
              ) : null}
            </div>
          }
        />
      </SettingsGroupCard>

      <p className="text-ui-sm text-foreground-subtle">
        {message("settings.localRemote.hint")}
      </p>
      {error ? <p className="text-ui-sm text-destructive">{error}</p> : null}
    </div>
  );
}
