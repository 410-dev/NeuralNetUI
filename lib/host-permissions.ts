export const HOST_PERMISSION_DEFINITIONS = [
  { key: "files.search", riskLevel: 1 },
  { key: "files.inspect", riskLevel: 1 },
  { key: "files.read", riskLevel: 2 },
  { key: "files.copy", riskLevel: 3 },
  { key: "files.copyOverwrite", riskLevel: 3 },
  { key: "files.write", riskLevel: 3 },
  { key: "files.writeOverwrite", riskLevel: 3 },
  { key: "files.rename", riskLevel: 3 },
  { key: "files.move", riskLevel: 3 },
  { key: "files.moveOverwrite", riskLevel: 4 },
  { key: "files.delete", riskLevel: 4 },
  { key: "files.deleteRecursive", riskLevel: 4 },
  { key: "network.uploadTemp", riskLevel: 3 },
  { key: "process.start", riskLevel: 3 },
  { key: "process.list", riskLevel: 1 },
  { key: "process.kill", riskLevel: 4 },
  { key: "powershell.risk1", riskLevel: 1 },
  { key: "powershell.risk2", riskLevel: 2 },
  { key: "powershell.risk3", riskLevel: 3 },
  { key: "powershell.risk4", riskLevel: 4 },
  { key: "powershell.risk5", riskLevel: 5 },
  { key: "bash.risk1", riskLevel: 1 },
  { key: "bash.risk2", riskLevel: 2 },
  { key: "bash.risk3", riskLevel: 3 },
  { key: "bash.risk4", riskLevel: 4 },
  { key: "bash.risk5", riskLevel: 5 },
  { key: "screen.screenshot", riskLevel: 2 },
] as const;

export type HostPermissionKey = typeof HOST_PERMISSION_DEFINITIONS[number]["key"];
export type HostTrustedPermissions = Record<HostPermissionKey, boolean>;
export type HostPermissionRiskLevel = 1 | 2 | 3 | 4 | 5;

export const HOST_PERMISSION_KEYS = HOST_PERMISSION_DEFINITIONS.map((definition) => definition.key) as HostPermissionKey[];

export function createHostTrustedPermissions(value = false): HostTrustedPermissions {
  return Object.fromEntries(HOST_PERMISSION_KEYS.map((key) => [key, value])) as HostTrustedPermissions;
}

/** Preserve the old risk-level policy exactly when a beta-2 configuration is first read. */
export function hostPermissionsFromRiskLevels(levels: unknown): HostTrustedPermissions {
  const legacy = Array.isArray(levels) ? levels : [];
  return Object.fromEntries(HOST_PERMISSION_DEFINITIONS.map(({ key, riskLevel }) => [key, legacy[riskLevel - 1] === true])) as HostTrustedPermissions;
}

export function hostPermissionForAction(args: Record<string, unknown>, riskLevel: HostPermissionRiskLevel): HostPermissionKey | undefined {
  const action = String(args.action || "");
  switch (action) {
    case "search_files": return "files.search";
    case "inspect_path": return "files.inspect";
    case "read_file": return "files.read";
    case "copy": return args.overwrite === true ? "files.copyOverwrite" : "files.copy";
    case "write_file": return args.overwrite === true ? "files.writeOverwrite" : "files.write";
    case "rename": return "files.rename";
    case "move": return args.overwrite === true ? "files.moveOverwrite" : "files.move";
    case "delete": return args.recursive === true ? "files.deleteRecursive" : "files.delete";
    case "upload_temp": return "network.uploadTemp";
    case "start_process": return "process.start";
    case "list_processes": return "process.list";
    case "kill_process": return "process.kill";
    case "screenshot": return "screen.screenshot";
    case "run_shell": {
      const shell = String(args.shell || "").toLowerCase();
      if (shell !== "powershell" && shell !== "bash") return undefined;
      return `${shell}.risk${riskLevel}` as HostPermissionKey;
    }
    default: return undefined;
  }
}
