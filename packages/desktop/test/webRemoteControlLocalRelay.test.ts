import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  createWebRemoteControlLocalRelay,
  type WebRemoteControlLocalRelay,
} from "../src/main/webRemoteControlLocalRelay.js";

const logger = { info() {}, warn() {}, error() {} };
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function startRelay(pairCode = "123456"): Promise<WebRemoteControlLocalRelay> {
  const assetsDir = mkdtempSync(join(tmpdir(), "zcode-local-relay-"));
  writeFileSync(
    join(assetsDir, "index.html"),
    "<!doctype html><html><head></head><body>ok</body></html>",
  );
  const relay = await createWebRemoteControlLocalRelay({
    assetsDir,
    deviceMid: "test-device",
    pairCode,
    port: 0,
    logger,
  });
  cleanups.push(async () => {
    await relay.close();
    rmSync(assetsDir, { recursive: true, force: true });
  });
  return relay;
}

function tokenRequest(
  relay: WebRemoteControlLocalRelay,
  body: Record<string, unknown>,
  sessionToken?: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${relay.port}/api/v1/remote/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readTokenData(response: Response): Promise<{
  token: string;
  sessionToken?: string;
}> {
  const body = (await response.json()) as {
    data: { token: string; sessionToken?: string };
  };
  return body.data;
}

function connect(
  relay: WebRemoteControlLocalRelay,
  token: string,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${relay.port}/api/v1/remote/ws2?token=${token}`,
    );
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, 3_000);
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

describe("webRemoteControlLocalRelay", () => {
  it("pairs once and rejects pair code reuse", async () => {
    const relay = await startRelay();
    const first = await tokenRequest(relay, { role: "terminal", pairCode: "123456" });
    expect(first.status).toBe(200);
    expect((await readTokenData(first)).sessionToken).toBeTruthy();

    const second = await tokenRequest(relay, { role: "terminal", pairCode: "123456" });
    expect(second.status).toBe(401);
  });

  it("exchanges a session token for a relay token", async () => {
    const relay = await startRelay();
    const paired = await tokenRequest(relay, { role: "terminal", pairCode: "123456" });
    const { sessionToken } = await readTokenData(paired);
    const next = await tokenRequest(relay, { role: "terminal" }, sessionToken);
    expect(next.status).toBe(200);
    expect((await readTokenData(next)).token).toBeTruthy();
  });

  it("blocks the source after five wrong pair codes", async () => {
    const relay = await startRelay();
    for (let index = 0; index < 5; index += 1) {
      const response = await tokenRequest(relay, {
        role: "terminal",
        pairCode: "000000",
      });
      expect(response.status).toBe(401);
    }
    expect(
      (await tokenRequest(relay, { role: "terminal", pairCode: "000000" })).status,
    ).toBe(429);
    expect(
      (await tokenRequest(relay, { role: "terminal", pairCode: "123456" })).status,
    ).toBe(429);
  });

  it("revokeAll invalidates session tokens and re-enables pairing", async () => {
    const relay = await startRelay();
    const paired = await tokenRequest(relay, { role: "terminal", pairCode: "123456" });
    const { sessionToken } = await readTokenData(paired);
    relay.revokeAll();
    expect((await tokenRequest(relay, { role: "terminal" }, sessionToken)).status).toBe(
      401,
    );
    expect(
      (await tokenRequest(relay, { role: "terminal", pairCode: "123456" })).status,
    ).toBe(200);
  });

  it("replaces the previous terminal with KICKED", async () => {
    const relay = await startRelay();
    const deviceToken = await readTokenData(
      await tokenRequest(relay, { role: "device" }, relay.sessionToken),
    );
    const device = await connect(relay, deviceToken.token);
    device.send(
      JSON.stringify({ type: "auth_init", device_sid: relay.deviceSid }),
    );
    await nextMessage(device, "auth_ack");

    const paired = await tokenRequest(relay, { role: "terminal", pairCode: "123456" });
    const { sessionToken } = await readTokenData(paired);
    const firstToken = await readTokenData(
      await tokenRequest(relay, { role: "terminal" }, sessionToken),
    );
    const first = await connect(relay, firstToken.token);
    first.send(
      JSON.stringify({ type: "auth_init", device_sid: relay.deviceSid }),
    );
    await nextMessage(first, "auth_ack");

    const kicked = nextMessage(first, "error");
    const secondToken = await readTokenData(
      await tokenRequest(relay, { role: "terminal" }, sessionToken),
    );
    const second = await connect(relay, secondToken.token);
    second.send(
      JSON.stringify({ type: "auth_init", device_sid: relay.deviceSid }),
    );
    await nextMessage(second, "auth_ack");

    expect((await kicked).code).toBe("KICKED");
    for (const socket of [device, first, second]) socket.close();
  });
});
