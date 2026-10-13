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
});
