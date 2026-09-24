import { useCallback, useEffect, useState } from "react";
import type { ProviderBalanceSnapshot } from "@zcode/shared";
import { logger } from "@/logger.js";
import { useServices } from "@/hooks/useServices.js";

/**
 * 读取各厂商额度快照。
 *
 * 额度来源是用户已配置的 API Key，未配置的厂商不出现在结果里；因此这个 hook 不需要
 * 登录态、也不需要任何开关，挂载即查询，用户点刷新再查一次。
 */
export function useProviderBalance() {
  const { providerBalanceService } = useServices();
  const [snapshot, setSnapshot] = useState<ProviderBalanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await providerBalanceService.getSnapshot();
      setSnapshot(next);
      setError(null);
    } catch (caught) {
      logger.error("[provider-balance] 加载模型额度失败", caught);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [providerBalanceService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { snapshot, loading, error, refresh } as const;
}
