import { describe, expect, it, vi } from "vitest";
import { resolveWebCommunityUrl, resolveWebHelpConfig } from "../src/communityUrl.js";

// ZCode-Libre：社群入口默认统一指向自有 Discussions（vendorCommunityLinks=false，
// resolveCommunityUrlFromConfig 直接返回 LIBRE_COMMUNITY_URL）；这个文件验证的是远端/
// 内置配置的解析与回退语义本身，因此 mock 开关为开启，与分支默认值解耦。
// mock 的是解析后的真身文件：remoteAppConfig.ts 以相对路径导入 libre-features，
// mock 包索引 @zcode/shared 拦不到这条内部导入链。
vi.mock("../../shared/src/libre-features.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../shared/src/libre-features.js")
  >();
  return {
    ...actual,
    LIBRE_VENDOR_SERVICES: { ...actual.LIBRE_VENDOR_SERVICES, vendorCommunityLinks: true },
  };
});

const LOCAL_CONFIG = {
  community_urls: {
    "zh-CN": "https://local.example.com/feishu",
    "en-US": "https://local.example.com/discord",
  },
};

describe("resolveWebCommunityUrl", () => {
  it.each([404, 500, 503])("HTTP %i 时回退内置同语言入口", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status,
    } as Response);

    await expect(
      resolveWebCommunityUrl("zh-CN", { fetchImpl, localConfig: LOCAL_CONFIG }),
    ).resolves.toBe("https://local.example.com/feishu");
    await expect(
      resolveWebCommunityUrl("en-US", { fetchImpl, localConfig: LOCAL_CONFIG }),
    ).resolves.toBe("https://local.example.com/discord");
  });

  it("远端缺少当前语言时回退内置同语言入口", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          configs: {
            feedbackUrl: {
              community_urls: { "zh-CN": "https://remote.example.com/feishu" },
            },
          },
        },
      }),
    } as Response);

    await expect(
      resolveWebCommunityUrl("en-US", { fetchImpl, localConfig: LOCAL_CONFIG }),
    ).resolves.toBe("https://local.example.com/discord");
  });
});

it("使用部署 endpoint 的新接口并提取反馈地址", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json({
      code: 0,
      data: {
        configs: {
          feedbackUrl: {
            feedback_url: "https://remote.feedback",
            community_urls: { "zh-CN": "https://remote.community" },
          },
        },
      },
    }),
  );
  expect(
    (await resolveWebHelpConfig({ fetchImpl, endpointOrigin: "https://test.example.com" }))
      .feedback_url,
  ).toBe("https://remote.feedback");
  expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.has("platform")).toBe(false);
  expect(fetchImpl.mock.calls[0][0]).toContain("https://test.example.com/api/v1/client/configs?");
  expect(await resolveWebCommunityUrl("zh-CN", { fetchImpl })).toBe("https://remote.community");
});
