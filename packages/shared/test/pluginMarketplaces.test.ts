import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PLUGIN_MARKETPLACES, isPublicStoreMarketplaceId } from "../src/index.js";

// ZCode-Libre：默认不播种任何远端市场源；这个文件验证的是开关开启时的完整市场集合，
// 因此 mock 策略模块为开启，与分支默认值解耦（默认关闭行为由 check:defaults 断言）。
vi.mock("../src/libre-features.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/libre-features.js")>();
  return {
    ...actual,
    LIBRE_VENDOR_SERVICES: { ...actual.LIBRE_VENDOR_SERVICES, pluginMarketplaceRemoteSource: true },
  };
});

describe("DEFAULT_PLUGIN_MARKETPLACES", () => {
  it("includes the official CDN marketplace and the Claude official marketplace", () => {
    expect(DEFAULT_PLUGIN_MARKETPLACES).toEqual([
      expect.objectContaining({
        id: "zcode-plugins-official",
        name: "zcode-plugins-official",
        pluginCount: 0,
        source: "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json",
      }),
      expect.objectContaining({
        id: "claude-plugins-official",
        name: "claude-plugins-official",
        pluginCount: 0,
        source: "anthropics/claude-plugins-official",
      }),
    ]);
  });

  it("classifies only the ZCode-operated channels as public store marketplaces", () => {
    expect(isPublicStoreMarketplaceId("zcode-plugins-official")).toBe(true);
    expect(isPublicStoreMarketplaceId("zcode-plugins")).toBe(false);
    // Claude 官方市场受信但不属于「公开」分段（归个人），见 CONTEXT.md 术语表。
    expect(isPublicStoreMarketplaceId("claude-plugins-official")).toBe(false);
    expect(isPublicStoreMarketplaceId("inline")).toBe(false);
  });
});
