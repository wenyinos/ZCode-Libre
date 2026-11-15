import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import type {
  WebRemoteControlLocalAddress,
  WebRemoteControlLocalAddressKind,
} from "@zcode/shared";
import {
  parseWebRemoteControlRelayV2HttpRequest,
  parseWebRemoteControlRelayV2OutgoingMessage,
  WEB_REMOTE_CONTROL_RELAY_V2_HTTP,
  WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH,
  type WebRemoteControlRelayV2Device,
  type WebRemoteControlRelayV2ErrorCode,
  type WebRemoteControlRelayV2IncomingMessage,
  type WebRemoteControlRelayV2Meta,
  type WebRemoteControlRelayV2Role,
} from "@zcode/shared/web-remote-relay";

const LOCAL_RELAY_PORT = 47821;
export const WEB_REMOTE_CONTROL_LOCAL_RELAY_PORT = LOCAL_RELAY_PORT;
const TOKEN_TTL_MS = 60_000;
const MAX_MESSAGE_BYTES = 1_048_576;
const REMOTE_ROUTE = "/remote/v4";

interface LocalRelayConnection {
  id: string;
  socket: WebSocket;
  role: WebRemoteControlRelayV2Role;
  deviceSid?: string;
  terminalSid: string;
  meta: WebRemoteControlRelayV2Meta;
}

export interface WebRemoteControlLocalRelayOptions {
  assetsDir: string;
  deviceMid: string;
  pairCode: string;
  port?: number;
  host?: string;
  /** 已持久化的本地设备 SID；缺失时生成新值，保证桌面重启后手机旧链接仍可认证。 */
  deviceSid?: string;
  /** 二维码使用的首选地址（如 ZeroTier 的 192.168.192.10）；缺失时按网卡优先级选择。 */
  preferredAddress?: string;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface WebRemoteControlLocalRelay {
  /** 当前二维码与手机访问使用的源，形如 http://192.168.8.110:47821。 */
  readonly origin: string;
  readonly port: number;
  /** 全部可用 IPv4 地址（含 ZeroTier），按优先级排序；监听本身覆盖所有网卡。 */
  readonly addresses: WebRemoteControlLocalAddress[];
  readonly relayWsUrl: string;
  readonly remoteUrl: string;
  readonly deviceSid: string;
  readonly pairCode: string;
  /** 桌面 device 端使用的稳定会话 token；手机端配对成功后获得独立 sessionToken。 */
  readonly sessionToken: string;
  /** 停止远控：撤销全部 token、配对码与已配对连接，但保留监听端口。 */
  revokeAll(): void;
  close(): Promise<void>;
}

/**
 * 局域网模式的最小 Relay V2 实现。
 *
 * 与云端 relay 的差异只在鉴权与地址来源：device/terminal 配对、一次性 token、
 * auth_init/pair_status/data 透传和 owner 替换语义保持与 Relay V2 一致，
 * 这样手机页面的 transport 与 bridge 不需要任何分支。
 */
export function createWebRemoteControlLocalRelay(
  options: WebRemoteControlLocalRelayOptions,
): Promise<WebRemoteControlLocalRelay> {
  const now = Date.now;
  const deviceSid =
    options.deviceSid?.trim() ||
    `local_${randomBytes(12).toString("hex")}`;
  const createdAt = Math.floor(now() / 1000);
  const tokens = new Map<
    string,
    { role: WebRemoteControlRelayV2Role; expiresAt: number }
  >();
  // 配对码在本次远控生命周期内有效：第二台手机可用同一二维码替换第一台。
  // 每次配对成功签发独立 sessionToken；停止远控时由 revokeAll() 统一撤销。
  let deviceSessionToken = randomBytes(24).toString("base64url");
  const sessionTokens = new Set<string>([deviceSessionToken]);
  const pairFailures = new Map<
    string,
    { count: number; blockedUntil: number }
  >();
  const connections = new Set<LocalRelayConnection>();
  const owners = new Map<
    string,
    Partial<Record<WebRemoteControlRelayV2Role, LocalRelayConnection>>
  >();
  const wsServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });
  let closed = false;

  function resolveListeningAddress(): { origin: string; port: number } {
    const address = server.address();
    const port =
      typeof address === "object" && address
        ? address.port
        : (options.port ?? LOCAL_RELAY_PORT);
    return {
      origin: `http://${selectLanAddress(options.preferredAddress)}:${port}`,
      port,
    };
  }

  function deviceView(): WebRemoteControlRelayV2Device {
    const online = Boolean(owners.get(deviceSid)?.device);
    return {
      device_sid: deviceSid,
      device_mid: options.deviceMid,
      online,
      created_at: createdAt,
      meta: online
        ? { name: options.deviceMid, platform: process.platform }
        : {},
    };
  }

  function send(
    connection: LocalRelayConnection,
    message: WebRemoteControlRelayV2IncomingMessage,
  ) {
    if (connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.send(JSON.stringify(message));
    }
  }

  function peer(
    connection: LocalRelayConnection,
  ): LocalRelayConnection | undefined {
    if (!connection.deviceSid) return undefined;
    const roles = owners.get(connection.deviceSid);
    return roles?.[connection.role === "device" ? "terminal" : "device"];
  }

  function reply(
    response: ServerResponse,
    status: number,
    data?: unknown,
    code = 0,
    msg = "",
  ) {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({ code, msg, ...(data === undefined ? {} : { data }) }),
    );
  }

  async function readBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  function isPrivateSource(address: string | undefined): boolean {
    if (!address) return false;
    const ip = address.startsWith("::ffff:")
      ? address.slice("::ffff:".length)
      : address;
    if (ip === "127.0.0.1" || ip === "::1") return true;
    return isPrivateIpv4(ip);
  }

  function serveStatic(pathname: string, response: ServerResponse) {
    const relative =
      pathname === REMOTE_ROUTE || pathname === `${REMOTE_ROUTE}/`
        ? "/index.html"
        : pathname.startsWith(`${REMOTE_ROUTE}/`)
          ? pathname.slice(REMOTE_ROUTE.length)
          : null;
    if (!relative) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    const normalized = normalize(relative).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(options.assetsDir, normalized);
    if (!filePath.startsWith(resolve(options.assetsDir))) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      if (extname(normalized)) {
        response.writeHead(404);
        response.end("not found");
        return;
      }
      filePath = join(options.assetsDir, "index.html");
    }
    const type = mimeType(filePath);
    response.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  }

  const server = createServer(async (request, response) => {
    const source = request.socket.remoteAddress;
    if (!isAllowedSource(source)) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      });
      response.end();
      return;
    }
    if (!url.pathname.startsWith("/api/v1/remote")) {
      serveStatic(url.pathname, response);
      return;
    }

    let body: unknown;
    try {
      body = await readBody(request);
    } catch {
      request.socket.destroy();
      return;
    }
    const authorization = request.headers.authorization
      ?.match(/^Bearer (.+)$/i)?.[1]
      ?.trim();
    const bodyRecord =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : undefined;
    const pairCode =
      typeof bodyRecord?.pairCode === "string"
        ? bodyRecord.pairCode.trim()
        : undefined;
    const sourceKey = source ?? "unknown";

    if (
      url.pathname === WEB_REMOTE_CONTROL_RELAY_V2_HTTP.token.path &&
      request.method === "POST"
    ) {
      const parsed = parseWebRemoteControlRelayV2HttpRequest("token", body);
      const roleFromPairCode = pairCode
        ? parseWebRemoteControlRelayV2HttpRequest("token", {
            role: bodyRecord?.role,
          })
        : null;
      if (!parsed && !roleFromPairCode) {
        reply(response, 400, undefined, 3001, "parameter error");
        return;
      }
      if (pairCode) {
        // 配对码路径：连续失败按来源暂停，避免暴力猜测；成功后签发独立 sessionToken。
        const failure = pairFailures.get(sourceKey);
        if (failure && failure.blockedUntil > now()) {
          reply(response, 429, undefined, 429, "too many attempts");
          return;
        }
        if (pairCode !== options.pairCode) {
          const count = (failure?.count ?? 0) + 1;
          pairFailures.set(sourceKey, {
            count: count >= 5 ? 0 : count,
            blockedUntil: count >= 5 ? now() + 60_000 : 0,
          });
          reply(response, 401, undefined, 401, "pairing failed");
          return;
        }
        pairFailures.delete(sourceKey);
        const sessionToken = randomBytes(24).toString("base64url");
        sessionTokens.add(sessionToken);
        const token = randomBytes(16).toString("base64url");
        tokens.set(token, {
          role: roleFromPairCode!.role,
          expiresAt: now() + TOKEN_TTL_MS,
        });
        response.setHeader("Cache-Control", "no-store");
        reply(response, 200, {
          token,
          expires_in: TOKEN_TTL_MS / 1_000,
          sessionToken,
        });
        return;
      }
      if (!authorization || !sessionTokens.has(authorization)) {
        reply(response, 401, undefined, 401, "unauthorized");
        return;
      }
      const token = randomBytes(16).toString("base64url");
      tokens.set(token, {
        role: parsed!.role,
        expiresAt: now() + TOKEN_TTL_MS,
      });
      response.setHeader("Cache-Control", "no-store");
      reply(response, 200, { token, expires_in: TOKEN_TTL_MS / 1_000 });
      return;
    }
    if (!authorization || !sessionTokens.has(authorization)) {
      reply(response, 401, undefined, 401, "unauthorized");
      return;
    }
    if (
      url.pathname === WEB_REMOTE_CONTROL_RELAY_V2_HTTP.register.path &&
      request.method === "POST"
    ) {
      const parsed = parseWebRemoteControlRelayV2HttpRequest("register", body);
      if (!parsed) {
        reply(response, 400, undefined, 3001, "parameter error");
        return;
      }
      reply(response, 200, deviceView());
      return;
    }
    if (
      url.pathname === WEB_REMOTE_CONTROL_RELAY_V2_HTTP.list.path &&
      request.method === "GET"
    ) {
      reply(response, 200, [deviceView()]);
      return;
    }
    if (
      url.pathname === WEB_REMOTE_CONTROL_RELAY_V2_HTTP.delete.path &&
      request.method === "POST"
    ) {
      reply(response, 200);
      return;
    }
    reply(response, 404);
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const source = request.socket.remoteAddress;
    if (!isAllowedSource(source)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const token = url.searchParams.get("token") ?? "";
    const identity = tokens.get(token);
    if (
      url.pathname !== WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH ||
      !identity ||
      identity.expiresAt <= now()
    ) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    tokens.delete(token);
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      const connection: LocalRelayConnection = {
        id: randomUUID(),
        socket: ws,
        role: identity.role,
        terminalSid:
          identity.role === "terminal"
            ? `t_${randomBytes(8).toString("hex")}`
            : "",
        meta: {},
      };
      connections.add(connection);
      ws.on("error", () => ws.terminate());
      ws.on("message", (data, isBinary) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (isBinary) {
          send(connection, { type: "error", code: "WRONG_PARAM" });
          ws.close();
          return;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(data.toString());
        } catch {
          send(connection, { type: "error", code: "WRONG_PARAM" });
          ws.close();
          return;
        }
        const parsed = parseWebRemoteControlRelayV2OutgoingMessage(raw);
        if (!parsed) {
          send(connection, { type: "error", code: "WRONG_PARAM" });
          ws.close();
          return;
        }
        if (parsed.type === "auth_init") {
          if (connection.deviceSid) {
            send(connection, { type: "error", code: "WRONG_PARAM" });
            ws.close();
            return;
          }
          if (parsed.device_sid !== deviceSid) {
            send(connection, { type: "error", code: "AUTH_FAILED" });
            ws.close();
            return;
          }
          connection.deviceSid = parsed.device_sid;
          connection.meta = parsed.meta ?? {};
          const roles = owners.get(parsed.device_sid) ?? {};
          const old = roles[connection.role];
          roles[connection.role] = connection;
          owners.set(parsed.device_sid, roles);
          if (old && old !== connection) {
            send(old, { type: "error", code: "KICKED" });
            old.socket.close();
          }
          const other = peer(connection);
          const pairStatus = other ? "matched" : "waiting";
          if (other)
            send(other, {
              type: "pair_status_ack",
              pair_status: pairStatus,
              terminal_sid: "",
            });
          send(connection, {
            type: "auth_ack",
            device_sid: parsed.device_sid,
            terminal_sid: connection.terminalSid,
            pair_status: pairStatus,
          });
          return;
        }
        if (!connection.deviceSid) {
          send(connection, { type: "error", code: "AUTH_FAILED" });
          ws.close();
          return;
        }
        if (parsed.type === "pair_status_query") {
          const other = peer(connection);
          send(connection, {
            type: "pair_status_ack",
            pair_status: other ? "matched" : "waiting",
            terminal_sid: other?.terminalSid ?? "",
          });
          return;
        }
        const other = peer(connection);
        if (other) send(other, { type: "data", payload: parsed.payload });
        else send(connection, { type: "error", code: "INTERNAL" });
      });
      ws.on("close", () => {
        connections.delete(connection);
        const roles = owners.get(connection.deviceSid ?? "");
        // 被替换连接的 close 晚于新认证完成，必须按连接身份释放，不能只按 SID/role 删除。
        if (!roles || roles[connection.role] !== connection) return;
        delete roles[connection.role];
        const other = peer(connection);
        if (other) {
          send(other, {
            type: "pair_status_ack",
            pair_status: "waiting",
            terminal_sid: "",
          });
          if (connection.role === "device") {
            send(other, { type: "error", code: "DEVICE_OFFLINE" });
            other.socket.close();
          }
        }
        if (!roles.device && !roles.terminal)
          owners.delete(connection.deviceSid ?? "");
      });
    });
  });

  function isAllowedSource(address: string | undefined): boolean {
    return isPrivateSource(address);
  }

  return new Promise((resolveRelay, reject) => {
    server.once("error", (error) => {
      if (closed) return;
      reject(error);
    });
    server.listen(
      options.port ?? LOCAL_RELAY_PORT,
      options.host ?? "0.0.0.0",
      () => {
        const { origin, port } = resolveListeningAddress();
        const addresses = listWebRemoteControlLocalAddresses();
        options.logger.info(
          `[web-remote-control] local relay listening origin=${origin} addresses=${addresses
            .map((item) => `${item.interfaceName}:${item.address}:${item.kind}`)
            .join(",")} assets=${options.assetsDir}`,
        );
        resolveRelay({
          origin,
          port,
          addresses,
          relayWsUrl:
            origin.replace(/^http:/, "ws:") +
            WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH,
          remoteUrl: `${origin}${REMOTE_ROUTE}?pair=${encodeURIComponent(options.pairCode)}`,
          deviceSid,
          pairCode: options.pairCode,
          get sessionToken() {
            return deviceSessionToken;
          },
          revokeAll: () => {
            // 停止远控后旧 sessionToken、一次性 token、已配对连接全部失效；
            // relay 继续监听，重新启动时可重新配对。
            sessionTokens.clear();
            deviceSessionToken = randomBytes(24).toString("base64url");
            sessionTokens.add(deviceSessionToken);
            pairFailures.clear();
            tokens.clear();
            for (const connection of connections) connection.socket.close();
            connections.clear();
            owners.clear();
          },
          close: async () => {
            closed = true;
            for (const connection of connections) connection.socket.close();
            connections.clear();
            tokens.clear();
            sessionTokens.clear();
            owners.clear();
            await new Promise<void>((done) => server.close(() => done()));
            wsServer.close();
          },
        });
      },
    );
  });
}

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) {
    return false;
  }
  const [a = -1, b = -1] = octets;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function classifyWebRemoteControlLocalAddress(
  interfaceName: string,
  address: string,
): WebRemoteControlLocalAddressKind {
  const name = interfaceName.toLowerCase();
  if (name.startsWith("zt") || name.startsWith("zerotier")) return "zerotier";
  if (
    name.startsWith("docker") ||
    name.startsWith("veth") ||
    name.startsWith("br-") ||
    name.startsWith("vmnet") ||
    name.startsWith("tailscale") ||
    name.startsWith("tun") ||
    name.startsWith("utun")
  ) {
    return "virtual";
  }
  return isPrivateIpv4(address) ? "physical" : "public";
}

/** 全部可用 IPv4 地址，按 物理网卡 > ZeroTier > 其他虚拟网卡 > 公网 排序。 */
export function listWebRemoteControlLocalAddresses(): WebRemoteControlLocalAddress[] {
  const order: Record<WebRemoteControlLocalAddressKind, number> = {
    physical: 0,
    zerotier: 1,
    virtual: 2,
    public: 3,
  };
  const result: WebRemoteControlLocalAddress[] = [];
  for (const [interfaceName, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      result.push({
        address: address.address,
        interfaceName,
        kind: classifyWebRemoteControlLocalAddress(
          interfaceName,
          address.address,
        ),
      });
    }
  }
  return result.sort((left, right) => order[left.kind] - order[right.kind]);
}

/**
 * 二维码使用的地址：显式首选 > 物理网卡 > ZeroTier > 虚拟网卡；公网地址默认不选。
 * 监听仍是 0.0.0.0，所有网卡同时可达，这里只决定二维码里写哪一个。
 */
function selectLanAddress(preferred?: string): string {
  const addresses = listWebRemoteControlLocalAddresses();
  const preferredAddress = preferred?.trim();
  if (preferredAddress) {
    const matched = addresses.find(
      (item) => item.address === preferredAddress,
    );
    if (matched) return matched.address;
  }
  return (
    addresses.find((item) => item.kind !== "public")?.address ??
    addresses[0]?.address ??
    "127.0.0.1"
  );
}

function mimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}
