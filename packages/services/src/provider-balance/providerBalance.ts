import type { ProviderBalanceSnapshot } from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IProviderBalanceService {
  /** 查询所有已配置 API Key 的厂商额度；未配置的厂商不会出现在结果里。 */
  getSnapshot(): Promise<ProviderBalanceSnapshot>;
}

export const IProviderBalanceService = createServiceDescriptor<IProviderBalanceService>(
  ServiceChannels.ProviderBalance,
);
