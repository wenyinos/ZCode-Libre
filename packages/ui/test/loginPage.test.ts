import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const oauthState = vi.hoisted(() => ({
  status: "idle",
  error: null as string | null,
  loadingProviders: true,
  providers: [] as Array<{
    id: string;
    displayName: string;
    enabled: boolean;
    order: number;
  }>,
}));

// 静态渲染也会构造登录页窗控，使用与桌面入口一致的平台依赖。
vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({ executeDesktopCommand: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/hooks/useOAuth.js", () => ({
  useOAuth: () => ({
    startLogin: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    status: oauthState.status,
    error: oauthState.error,
    providers: oauthState.providers,
    activeProvider: null,
    loadingProviders: oauthState.loadingProviders,
    pendingProvider: null,
    refreshProviders: vi.fn(),
  }),
}));

// 本文件锁定的是官方登录渠道面板的样式，因此把供应商服务策略里的官方登录打开，
// 让 WelcomeScreen 落在 providers 初始态，与分支默认值解耦。
vi.mock("@zcode/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zcode/shared")>();
  return {
    ...actual,
    LIBRE_VENDOR_SERVICES: {
      ...actual.LIBRE_VENDOR_SERVICES,
      officialAccountLogin: true,
    },
  };
});

// ZCode-Libre：官方账号登录关闭后，登录页静态渲染会直达 API Key 表单；
// 该表单只在异步保存里用到 Root services，这里提供占位即可。
vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({
    modelSelectionService: {},
    providerSettingsService: {},
    settingService: {},
  }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: null,
      oauthError: null,
      setOAuthError: vi.fn(),
      oauthSuccessSeq: 0,
      lastOAuthSuccessProvider: null,
      loginEntryRequest: null,
      loginEntryAttempt: null,
      clearLoginEntryRequest: vi.fn(),
      markLoginEntryAttemptStatus: vi.fn(),
    }),
}));

describe("WelcomeScreen", () => {
  it("已有用户不会完成新发起的 Provider 登录尝试", async () => {
    const { shouldCompleteLoginFromExistingUser, shouldCompleteProviderLoginAttempt } =
      await import("@/WelcomeScreen.js");
    const attempt = { id: 9, providerId: "bigmodel" as const };

    expect(shouldCompleteLoginFromExistingUser({ hasUser: true, attempt })).toBe(false);
    expect(shouldCompleteProviderLoginAttempt({ attempt, successProvider: "zai" })).toBe(false);
    expect(shouldCompleteProviderLoginAttempt({ attempt, successProvider: "bigmodel" })).toBe(true);
  });

  it("使用项目选择页主题大背景和 background 登录面板", async () => {
    oauthState.status = "idle";
    oauthState.error = null;
    oauthState.loadingProviders = true;

    const { WelcomeScreen } = await import("@/WelcomeScreen.js");
    const html = renderToStaticMarkup(createElement(WelcomeScreen, { onComplete: vi.fn() }));

    expect(html).toContain("overflow-hidden bg-background");
    expect(html).toContain("absolute inset-0");
    expect(html).toContain("bg-[linear-gradient");
    expect(html).toContain("bg-background");
    expect(html).toContain("border-popover-border");
    expect(html).toContain("shadow-md");
    expect(html).toContain("<h1");
    expect(html).not.toContain("DialogTitle");
  });

  it("登录报错使用 warning 样式并居中文案", async () => {
    oauthState.status = "error";
    oauthState.error = "登录失败，请重试";
    oauthState.loadingProviders = false;

    const { WelcomeScreen } = await import("@/WelcomeScreen.js");
    const html = renderToStaticMarkup(createElement(WelcomeScreen, { onComplete: vi.fn() }));

    expect(html).toContain("border-warning/40");
    expect(html).toContain("bg-warning/10");
    expect(html).toContain("text-warning");
    expect(html).toContain("text-center");
    expect(html).toContain("登录失败，请重试");
    expect(html).not.toContain("bg-destructive text-destructive-foreground");
  });

  it("地域标签使用登录按钮前景色弱强调样式", async () => {
    oauthState.status = "idle";
    oauthState.error = null;
    oauthState.loadingProviders = false;
    oauthState.providers = [
      {
        id: "zai",
        displayName: "Z.AI",
        enabled: true,
        order: 0,
      },
    ];

    const { WelcomeScreen } = await import("@/WelcomeScreen.js");
    const html = renderToStaticMarkup(createElement(WelcomeScreen, { onComplete: vi.fn() }));

    expect(html).toContain("border-primary-foreground/30");
    expect(html).toContain("text-primary-foreground/60");
    expect(html).not.toContain("bg-primary-foreground/10");
    expect(html).not.toContain("button-gradient");
  });
});
