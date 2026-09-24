import { logger } from "./logger.js";
import { initializeCrashCapture, type CrashCapturePaths } from "./desktopCrashCapture.js";
import { ZCODE_ARMS_RUM_ENDPOINT, ZCODE_TELEMETRY_ENABLED } from "@zcode/shared";

// 须在 appARMSBootstrap 之前完成：先由 desktopEarlyDataBaseDirBootstrap 注入 dataBaseDir，再配置 crashDumps。
// 第二个参数为 true 表示"ARMS 已接管远端 crash 上报"，此时不启动仅本地的 crashReporter。
// 遥测默认关闭，因此这里按实际遥测状态取值：关闭时走本地模式（submitURL 指向本地、不上传），不产生出网。
export const crashCapturePaths: CrashCapturePaths = initializeCrashCapture(
  logger,
  ZCODE_TELEMETRY_ENABLED && ZCODE_ARMS_RUM_ENDPOINT !== "",
);
