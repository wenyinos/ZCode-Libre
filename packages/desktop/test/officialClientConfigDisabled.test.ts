import { describe, expect, it, vi } from "vitest";
import { createDesktopContextPromptRollout } from "../src/main/desktopContextPromptRollout.js";
import { createRendererActionTraceRollout } from "../src/main/rendererActionTraceRollout.js";

describe("official client config disabled by default", () => {
  it("does not request desktop context prompt config", async () => {
    const fetchConfig = vi.fn(async () => ({ code: 0, data: { configs: {} } }));
    const rollout = createDesktopContextPromptRollout({
      fetchConfig,
      logger: { warn: vi.fn() },
    });

    await expect(rollout.refresh()).resolves.toEqual({ enabled: false });
    await expect(rollout.awaitFirstDecision(1_000)).resolves.toEqual({ enabled: false });
    expect(fetchConfig).not.toHaveBeenCalled();
  });

  it("does not request renderer action trace config", async () => {
    const fetchConfig = vi.fn(async () => ({ code: 0, data: { configs: {} } }));
    const rollout = createRendererActionTraceRollout({
      fetchConfig,
      logger: { warn: vi.fn() },
    });

    await expect(rollout.refresh()).resolves.toMatchObject({ enabled: false });
    await expect(rollout.awaitFirstDecision(1_000)).resolves.toMatchObject({ enabled: false });
    expect(fetchConfig).not.toHaveBeenCalled();
  });
});
