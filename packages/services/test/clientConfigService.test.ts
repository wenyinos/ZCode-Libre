import { describe, expect, it } from "vitest";
import { createDisabledClientConfigService } from "#src/client-config/clientConfigService.js";

describe("DisabledClientConfigService", () => {
  it("returns an empty snapshot without network access", async () => {
    await expect(createDisabledClientConfigService().getSnapshot()).resolves.toEqual({
      pluginStoreOrder: null,
      zsrcUrl: null,
      uiPluginRecommendations: [],
    });
  });
});
