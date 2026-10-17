import { EventEmitter } from "node:events";
import { PlatformChannels } from "@zcode/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  loggerInfoMock,
  loggerWarnMock,
  loggerErrorMock,
  readFileMock,
  spawnMock,
  checkSelfHostedReleaseMock,
} = vi.hoisted(() => ({
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  readFileMock: vi.fn(),
  spawnMock: vi.fn(),
  checkSelfHostedReleaseMock: vi.fn(),
}));

const browserWindows: Array<{
  isDestroyed: () => boolean;
  webContents: {
    id: number;
    send: ReturnType<typeof vi.fn>;
  };
}> = [];

const menuItem = {
  label: "",
  enabled: true,
};

const ipcMainOn = vi.fn();
const ipcMainHandle = vi.fn();

const appMock = {
  isPackaged: true,
  getVersion: vi.fn(() => "0.1.24"),
  getAppPath: vi.fn(() => "/tmp/zcode-app"),
  relaunch: vi.fn(),
  exit: vi.fn(),
  on: vi.fn(),
};

const autoUpdaterMock = new EventEmitter() as EventEmitter & {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: unknown;
  checkForUpdates: ReturnType<typeof vi.fn>;
  downloadUpdate: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
  setFeedURL: ReturnType<typeof vi.fn>;
  forceDevUpdateConfig: boolean;
  currentVersion: { format(): string } | null;
  installerPath: string | null;
  autoRunAppAfterInstall: boolean;
  installDirectory: string | null;
  downloadedUpdateHelper: {
    downloadedFileInfo?: { isAdminRightsRequired?: boolean } | null;
    packageFile?: string | null;
  } | null;
};

autoUpdaterMock.autoDownload = false;
autoUpdaterMock.autoInstallOnAppQuit = false;
autoUpdaterMock.checkForUpdates = vi.fn(() => Promise.resolve());
autoUpdaterMock.downloadUpdate = vi.fn(() => Promise.resolve([]));
autoUpdaterMock.quitAndInstall = vi.fn();
autoUpdaterMock.setFeedURL = vi.fn();
autoUpdaterMock.forceDevUpdateConfig = false;
autoUpdaterMock.currentVersion = null;
autoUpdaterMock.installerPath = null;
autoUpdaterMock.autoRunAppAfterInstall = true;
autoUpdaterMock.installDirectory = null;
autoUpdaterMock.downloadedUpdateHelper = null;

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

// 本文件验证 ZCode-Libre 的默认形态：selfHostedReleaseUpdates=true，因此不覆盖
// @zcode/shared 的策略值，直接用分支默认。厂商链路一侧（策略为 false）由
// autoUpdaterReadyState.test.ts 覆盖。
vi.mock("../src/main/githubReleaseUpdates.js", () => ({
  checkSelfHostedRelease: checkSelfHostedReleaseMock,
}));

vi.mock("electron", () => ({
  app: appMock,
  BrowserWindow: {
    getAllWindows: vi.fn(() => browserWindows),
  },
  ipcMain: {
    on: ipcMainOn,
    handle: ipcMainHandle,
  },
  Menu: {
    getApplicationMenu: vi.fn(() => ({
      getMenuItemById: vi.fn(() => menuItem),
    })),
  },
}));

vi.mock("electron-updater", () => {
  class CancellationTokenMock {
    cancelled = false;

    cancel() {
      this.cancelled = true;
    }

    once() {
      return this;
    }

    dispose() {}
  }

  class ProviderMock {
    constructor() {}
    get isUseMultipleRangeRequest() {
      return false;
    }
    setRequestHeaders() {}
  }

  return {
    CancellationToken: CancellationTokenMock,
    Provider: ProviderMock,
    default: {
      autoUpdater: autoUpdaterMock,
    },
  };
});

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
}));

vi.mock("../src/main/logger.js", () => ({
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  },
}));

describe("autoUpdater 自有 Release 手动检查", () => {
  beforeEach(() => {
    vi.resetModules();
    browserWindows.length = 0;
    menuItem.label = "";
    menuItem.enabled = true;
    ipcMainOn.mockClear();
    ipcMainHandle.mockClear();
    spawnMock.mockClear();
    loggerInfoMock.mockClear();
    loggerWarnMock.mockClear();
    loggerErrorMock.mockClear();
    appMock.getVersion.mockClear();
    autoUpdaterMock.removeAllListeners();
    autoUpdaterMock.checkForUpdates.mockClear();
    autoUpdaterMock.downloadUpdate.mockClear();
    autoUpdaterMock.setFeedURL.mockClear();
    readFileMock.mockReset();
    readFileMock.mockRejectedValue(new Error("missing update config"));
    checkSelfHostedReleaseMock.mockReset();
  });

  it("构建期未启用厂商更新（enabled:false）时，手动检查仍走自有 Release 检测", async () => {
    // Bugfix 回归：上游 v3.15.1 把 enabled 叠加了构建期开关，公开仓库构建会得到
    // enabled=false；此时 flavor 闸不得拦住手动检查——自有检测不经过 electron-updater。
    checkSelfHostedReleaseMock.mockResolvedValue({
      kind: "up-to-date",
      currentVersion: "0.1.24",
    });
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 9,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);

    const { initAutoUpdater, checkForUpdateMenuClick } = await import("../src/main/autoUpdater.js");
    await initAutoUpdater({ enabled: false });
    checkForUpdateMenuClick(win as never);

    await vi.waitFor(() => {
      expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateCheckResult, {
        kind: "up-to-date",
        currentVersion: "0.1.24",
      });
    });
    expect(checkSelfHostedReleaseMock).toHaveBeenCalledWith("0.1.24");
    expect(win.webContents.send).not.toHaveBeenCalledWith(PlatformChannels.UpdateCheckResult, {
      kind: "dev-skipped",
    });
    expect(loggerInfoMock).not.toHaveBeenCalledWith(
      "[auto-update] skip manual check: updater disabled for this product flavor",
    );
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled();
  });

  it("自有 Release 有新版本时回执带下载页，不触发应用内下载", async () => {
    checkSelfHostedReleaseMock.mockResolvedValue({
      kind: "available",
      currentVersion: "0.1.24",
      release: {
        version: "9.9.9",
        tagName: "v9.9.9",
        downloadUrl: "https://github.com/wenyinos/ZCode-Libre/releases/tag/v9.9.9",
      },
    });
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 10,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);

    const { initAutoUpdater, checkForUpdateMenuClick } = await import("../src/main/autoUpdater.js");
    await initAutoUpdater({ enabled: false });
    checkForUpdateMenuClick(win as never);

    await vi.waitFor(() => {
      expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateCheckResult, {
        kind: "available",
        version: "9.9.9",
        downloadUrl: "https://github.com/wenyinos/ZCode-Libre/releases/tag/v9.9.9",
      });
    });
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
  });

  it("自有检查后不会装上厂商轮询表：越过轮询间隔也不打厂商 manifest", async () => {
    // Bugfix 回归：轮询表由 setAutoUpdaterMenuState 装配，自有检查自身也会触发状态变化。
    // 只挡 init 末尾的启动检查/首次轮询不够——装表后 15 分钟就会按厂商 manifest 轮询，
    // 把官方版本当可用更新自动弹窗（2026-10-17 实测）。
    // 必须用 enabled:true 复现真实构建：打包产物里 enabled 为真（构建期开关或自有分支），
    // init 才会走完并装上 recheckAfterDownload；enabled:false 会在 init 顶部直接 return。
    vi.useFakeTimers();
    try {
      checkSelfHostedReleaseMock.mockResolvedValue({
        kind: "up-to-date",
        currentVersion: "0.1.24",
      });
      const win = {
        isDestroyed: () => false,
        webContents: {
          id: 11,
          send: vi.fn(),
        },
      };
      browserWindows.push(win);

      const { initAutoUpdater, checkForUpdateMenuClick } = await import(
        "../src/main/autoUpdater.js"
      );
      await initAutoUpdater({ enabled: true });
      checkForUpdateMenuClick(win as never);
      await vi.advanceTimersByTimeAsync(0);

      expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateCheckResult, {
        kind: "up-to-date",
        currentVersion: "0.1.24",
      });
      // init 阶段的 feed 配置不算"打厂商 manifest"：它只是装好 provider，没人调用就不发请求。
      expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();

      // 越过 15 分钟轮询间隔与可见窗口的 2 分钟间隔，仍不得触碰厂商 manifest。
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("切换接收 preview 版本不会顺带打厂商 manifest", async () => {
    const { initAutoUpdater, refreshAutoUpdaterReleaseChannel } = await import(
      "../src/main/autoUpdater.js"
    );
    await initAutoUpdater({ enabled: true });

    refreshAutoUpdaterReleaseChannel(true);
    await Promise.resolve();

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
  });
});
