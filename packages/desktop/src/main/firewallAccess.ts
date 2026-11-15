import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WebRemoteControlLocalFirewallState } from "@zcode/shared";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 5_000;
const WINDOWS_RULE_NAME = "ZCode-Libre Local Remote";

export type { WebRemoteControlLocalFirewallState };

export interface FirewallSetupInfo {
  state: WebRemoteControlLocalFirewallState;
  /** 当前平台可直接执行的手动放行命令；空数组表示无需设置或无法给出通用命令。 */
  commands: string[];
  /** 无法只靠命令解决时的补充说明（例如 macOS 系统设置）。 */
  note?: string;
}

interface CommandResult {
  ok: boolean;
  stdout: string;
}

async function run(command: string, args: string[]): Promise<CommandResult> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

async function linuxFirewallKind(): Promise<"firewalld" | "ufw" | "none"> {
  const firewalld = await run("firewall-cmd", ["--state"]);
  if (firewalld.ok && firewalld.stdout.trim() === "running") return "firewalld";
  const ufw = await run("ufw", ["status"]);
  if (ufw.ok && /Status:\s*active/i.test(ufw.stdout)) return "ufw";
  return "none";
}

async function inspectLinux(port: number): Promise<FirewallSetupInfo> {
  const kind = await linuxFirewallKind();
  if (kind === "firewalld") {
    const zoneResult = await run("firewall-cmd", ["--get-default-zone"]);
    const zone = zoneResult.ok ? zoneResult.stdout.trim() : "public";
    const query = await run("firewall-cmd", [
      "--zone",
      zone,
      "--query-port",
      `${port}/tcp`,
    ]);
    const open = query.ok && query.stdout.trim() === "yes";
    return {
      state: open ? "open" : "closed",
      commands: open
        ? []
        : [
            `sudo firewall-cmd --permanent --add-port=${port}/tcp`,
            "sudo firewall-cmd --reload",
          ],
    };
  }
  if (kind === "ufw") {
    const ufw = await run("ufw", ["status"]);
    const open =
      ufw.ok &&
      ufw.stdout
        .split("\n")
        .some((line) => line.includes(`${port}/tcp`) && line.includes("ALLOW"));
    return {
      state: open ? "open" : "closed",
      commands: open ? [] : [`sudo ufw allow ${port}/tcp`],
    };
  }
  return { state: "open", commands: [] };
}

function inspectMac(port: number): FirewallSetupInfo {
  const appPath = process.execPath.match(/^(.*?\.app)(?:\/|$)/)?.[1];
  return {
    // macOS 应用防火墙针对 .app，命令行只作为备选；主要引导用户在系统设置里允许。
    state: "unknown",
    commands: appPath
      ? [
          `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "${appPath}"`,
          `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "${appPath}"`,
        ]
      : [],
    note: "系统设置 → 网络 → 防火墙 → 选项，允许 ZCode-Libre 的传入连接。",
  };
}

function inspectWindows(port: number): FirewallSetupInfo {
  return {
    state: "unknown",
    commands: [
      `netsh advfirewall firewall add rule name="${WINDOWS_RULE_NAME}" dir=in action=allow protocol=TCP localport=${port} profile=private,domain`,
    ],
    note: "以管理员身份运行命令；只对专用/域网络放行。",
  };
}

/**
 * 检测局域网远控端口的防火墙状态，并给出当前平台的手动放行命令。
 *
 * 不做自动提权：安装包与运行时都不改系统防火墙，由设置页展示命令让用户自行执行。
 */
export async function inspectFirewall(
  port: number,
): Promise<FirewallSetupInfo> {
  if (process.platform === "linux") return inspectLinux(port);
  if (process.platform === "darwin") return inspectMac(port);
  if (process.platform === "win32") return inspectWindows(port);
  return { state: "unsupported", commands: [] };
}
