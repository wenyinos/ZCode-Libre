import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRuntimeHostBuild, verifyRuntimeHostPe } from "../build-windows-runtime-host.mjs";

test("Windows builds both supported architectures with the matching MSVC target", () => {
  // 生成器交给 CMake 按 runner 上已装的 VS 自动选择：windows-latest 已是
  // VS 18 / CMake 4.4.5 镜像，硬编码 VS 17 2022 会让准备构建资源阶段直接失败。
  assert.deepEqual(resolveRuntimeHostBuild("x64", "win32").configureArgs, ["-A", "x64"]);
  assert.deepEqual(resolveRuntimeHostBuild("arm64", "win32").configureArgs, ["-A", "ARM64"]);
  assert.throws(() => resolveRuntimeHostBuild("ia32", "win32"), /architecture/);
});
test("cross builds explicitly select a Windows compiler", () => {
  assert.ok(
    resolveRuntimeHostBuild("x64", "linux").configureArgs.includes("-DCMAKE_SYSTEM_NAME=Windows"),
  );
  assert.ok(
    resolveRuntimeHostBuild("arm64", "linux", "example-clang++").configureArgs.includes(
      "-DCMAKE_CXX_COMPILER=example-clang++",
    ),
  );
});
test("packaging rejects wrong-architecture and corrupt PE binaries", () => {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 60);
  bytes.write("PE\0\0", 64);
  bytes.writeUInt16LE(0x8664, 68);
  verifyRuntimeHostPe(bytes, "x64");
  assert.throws(() => verifyRuntimeHostPe(bytes, "arm64"), /architecture/);
  assert.throws(() => verifyRuntimeHostPe(Buffer.from("bad"), "x64"), /PE/);
});
