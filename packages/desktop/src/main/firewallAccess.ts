/**
 * 局域网远控的防火墙说明。
 *
 * 本项目不检测、不修改系统防火墙，也不在安装包里加规则；这里只按平台返回
 * 用户可自行执行的命令，由远控对话框的「防火墙设置说明」展示。
 */
export interface FirewallSetupInfo {
  commands: string[];
  /** 命令之外的补充说明（例如 macOS 系统设置路径）。 */
  note?: string;
}

function resolveMacAppBundlePath(): string {
  return process.execPath.match(/^(.*?\.app)(?:\/|$)/)?.[1] ?? "/Applications/ZCode-Libre.app";
}

export function getFirewallSetupInfo(port: number): FirewallSetupInfo {
  if (process.platform === "linux") {
    return {
      commands: [
        "# firewalld",
        `sudo firewall-cmd --permanent --add-port=${port}/tcp`,
        "sudo firewall-cmd --reload",
        "# ufw",
        `sudo ufw allow ${port}/tcp`,
      ],
      note: "按当前系统实际启用的防火墙执行其中一组。",
    };
  }
  if (process.platform === "darwin") {
    const appPath = resolveMacAppBundlePath();
    return {
      commands: [
        `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "${appPath}"`,
        `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "${appPath}"`,
      ],
      note: "也可以：系统设置 → 网络 → 防火墙 → 选项，允许 ZCode-Libre 的传入连接。",
    };
  }
  if (process.platform === "win32") {
    return {
      commands: [
        `netsh advfirewall firewall add rule name="ZCode-Libre Local Remote" dir=in action=allow protocol=TCP localport=${port} profile=private,domain`,
      ],
      note: "以管理员身份运行；只对专用/域网络放行。",
    };
  }
  return { commands: [] };
}
