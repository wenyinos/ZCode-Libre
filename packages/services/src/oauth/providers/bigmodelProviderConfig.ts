import { BIGMODEL_PROVIDER_ID, LIBRE_VENDOR_SERVICES, buildBigModelApiUrl } from "@zcode/shared";
import type { OAuthProviderRuntimeConfig } from "../runtimeConfig.js";
import {
  buildDesktopOAuthRedirectUriFromEnv,
  buildZCodeApiUrlFromEnv,
  readBoolean,
  readEnv,
} from "./configUtils.js";

const BIGMODEL_USERINFO_PATH = "/api/biz/customer/getCustomerInfo";
const BIGMODEL_AUTHORIZE_PATH = "/login";

const BIGMODEL_OAUTH_PROVIDER_CONFIG: Omit<OAuthProviderRuntimeConfig, "appSecret"> = {
  id: BIGMODEL_PROVIDER_ID,
  displayName: "BigModel",
  // 默认值来自分支策略（见 libre-features.ts）：官方账号登录默认关闭，
  // 模型经 API Key 接入（bigmodel-api / bigmodel-standard-api 模板）。
  // 需要账号体系的自建部署可用 BIGMODEL_OAUTH_ENABLED=1 显式开启。
  enabled: LIBRE_VENDOR_SERVICES.officialAccountLogin,
  order: 0,
  authorizeUrl: "https://bigmodel.cn/login",
  tokenUrl: "https://zcode.z.ai/api/v1/oauth/token",
  userinfoUrl: buildBigModelApiUrl({ ZCODE_ENV: "production" }, BIGMODEL_USERINFO_PATH),
  appId: "zcode",
  redirectUri: "zcode://oauth/callback",
};

export function createBigModelProviderRuntimeConfig(
  env: NodeJS.ProcessEnv,
  signInEnabledOverride?: boolean,
): OAuthProviderRuntimeConfig {
  return {
    ...BIGMODEL_OAUTH_PROVIDER_CONFIG,
    // 优先级：环境变量 > 设置页开关 > 分支默认值（默认关闭）。
    enabled: readBoolean(
      env,
      "BIGMODEL_OAUTH_ENABLED",
      signInEnabledOverride ?? BIGMODEL_OAUTH_PROVIDER_CONFIG.enabled,
    ),
    authorizeUrl:
      readEnv(env, "BIGMODEL_OAUTH_AUTHORIZE_URL") ??
      buildBigModelApiUrl(env, BIGMODEL_AUTHORIZE_PATH),
    tokenUrl:
      readEnv(env, "BIGMODEL_OAUTH_TOKEN_URL") ??
      buildZCodeApiUrlFromEnv(env, "/api/v1/oauth/token"),
    userinfoUrl: resolveBigModelUserinfoUrl(env),
    appId: readEnv(env, "BIGMODEL_OAUTH_APP_ID") ?? BIGMODEL_OAUTH_PROVIDER_CONFIG.appId,
    redirectUri: buildDesktopOAuthRedirectUriFromEnv(env),
    // 历史 fallback secret 已废弃，不能再把内置密钥打进运行时配置。
    // 当前 BigModel callback 只消费 zcode OAuth token 路由，显式 appSecret 仅保留给
    // 旧接口兼容场景，缺失时必须保持 undefined。
    appSecret: readEnv(env, "BIGMODEL_OAUTH_APP_SECRET"),
  };
}

export function resolveBigModelUserinfoUrl(env: NodeJS.ProcessEnv): string {
  return (
    readEnv(env, "BIGMODEL_OAUTH_USERINFO_URL") ?? buildBigModelApiUrl(env, BIGMODEL_USERINFO_PATH)
  );
}
