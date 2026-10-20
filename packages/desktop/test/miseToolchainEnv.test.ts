import { describe, expect, it } from "vitest";
import { delimiter, dirname } from "node:path";

import { withPinnedNodePath } from "../../../scripts/mise-toolchain-env.mjs";

describe("mise toolchain child environment", () => {
  it("puts the launcher Node directory first without duplicating it", () => {
    // 用固定假路径构造：宿主 Node 若装在 /usr/bin，nodeDirectory 会与常规 PATH 项撞名，
    // 去重逻辑会把它们一并过滤，让断言依赖宿主安装布局。固定 nodeExecutablePath 隔离。
    const nodeExecutablePath = "/nix/store/zcode-node/bin/node";
    const nodeDirectory = dirname(nodeExecutablePath);
    const originalPath = ["/opt/homebrew/bin", nodeDirectory, "/usr/bin", nodeDirectory].join(
      delimiter,
    );

    const result = withPinnedNodePath({ PATH: originalPath, KEEP_ME: "yes" }, nodeExecutablePath);

    expect(result.PATH?.split(delimiter)).toEqual([nodeDirectory, "/opt/homebrew/bin", "/usr/bin"]);
    expect(result.KEEP_ME).toBe("yes");
  });

  it("preserves Windows Path casing so pnpm.cmd remains discoverable", () => {
    const nodeDirectory = dirname(process.execPath);
    const originalPath = ["C:/tools/pnpm", nodeDirectory, "C:/Windows/System32"].join(delimiter);

    const result = withPinnedNodePath({ Path: originalPath, KEEP_ME: "yes" }, process.execPath);

    // 修复原因：Windows 盘符包含 `:`，用 macOS/Linux 宿主分隔符拆分会先破坏模拟的 Windows 路径。
    expect(result.Path).toBe(
      [nodeDirectory, "C:/tools/pnpm", "C:/Windows/System32"].join(delimiter),
    );
    expect(result.PATH).toBeUndefined();
  });
});
