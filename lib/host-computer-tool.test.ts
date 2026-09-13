import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeHostComputerSession, deterministicHostAssessment, executeHostComputerTool, hostActionRequiresApproval, hostComputerToolDefinition, isShellHostAction } from "./host-computer-tool.ts";
import { canUseHostComputer, isHostComputerAvailable } from "./host-environment.ts";
import { createHostTrustedPermissions, hostPermissionForAction, hostPermissionsFromRiskLevels } from "./host-permissions.ts";

test("host tool exposes one bounded action surface", () => {
  const definition = hostComputerToolDefinition() as { function: { name: string; parameters: { properties: { action: { enum: string[] } } } } };
  assert.equal(definition.function.name, "host_computer");
  assert.ok(definition.function.parameters.properties.action.enum.includes("run_shell"));
  assert.ok(definition.function.parameters.properties.action.enum.includes("screenshot"));
  assert.ok(definition.function.parameters.properties.action.enum.includes("upload_temp"));
});

test("host access requires the feature, a real host, and Superadmin", () => {
  assert.equal(canUseHostComputer("superadmin", true, true), true);
  assert.equal(canUseHostComputer("admin", true, true), false);
  assert.equal(canUseHostComputer("user", true, true), false);
  assert.equal(canUseHostComputer("superadmin", false, true), false);
  assert.equal(canUseHostComputer("superadmin", true, false), false);
});

test("dedicated host actions receive their documented risk and transparent paths", () => {
  const read = deterministicHostAssessment({ action: "read_file", path: "C:/work/report.txt" }, "ko");
  assert.equal(read.riskLevel, 2); assert.match(read.explanation, /report\.txt/);
  const move = deterministicHostAssessment({ action: "move", path: "C:/from/a.txt", destination: "D:/to/a.txt" }, "en");
  assert.equal(move.riskLevel, 3); assert.match(move.explanation, /from.*a\.txt/i); assert.match(move.explanation, /to.*a\.txt/i);
  assert.equal(deterministicHostAssessment({ action: "delete", path: "C:/work", recursive: true }, "en").riskLevel, 4);
  assert.equal(deterministicHostAssessment({ action: "move", path: "C:/from", destination: "D:/to", overwrite: true }, "en").riskLevel, 4);
  assert.equal(isShellHostAction({ action: "run_shell" }), true);
});

test("partial trust maps exact sub-tool operations instead of broad risk levels", () => {
  const permissions = createHostTrustedPermissions();
  permissions["files.search"] = true;
  permissions["files.copy"] = true;
  permissions["powershell.risk2"] = true;
  const partial = { hostTrustMode: "partial" as const, hostTrustedPermissions: permissions };
  assert.equal(hostActionRequiresApproval({ ...partial, hostTrustMode: "full" }, { action: "delete" }, 4), false);
  assert.equal(hostActionRequiresApproval(partial, { action: "search_files" }, 1), false);
  assert.equal(hostActionRequiresApproval(partial, { action: "read_file" }, 2), true);
  assert.equal(hostActionRequiresApproval(partial, { action: "copy" }, 3), false);
  assert.equal(hostActionRequiresApproval(partial, { action: "copy", overwrite: true }, 3), true);
  assert.equal(hostActionRequiresApproval(partial, { action: "run_shell", shell: "powershell" }, 2), false);
  assert.equal(hostActionRequiresApproval(partial, { action: "run_shell", shell: "bash" }, 2), true);
  assert.equal(hostActionRequiresApproval({ ...partial, hostTrustMode: "none" }, { action: "search_files" }, 1), true);
});

test("conditional permission keys and legacy migration remain conservative", () => {
  assert.equal(hostPermissionForAction({ action: "write_file" }, 3), "files.write");
  assert.equal(hostPermissionForAction({ action: "write_file", overwrite: true }, 3), "files.writeOverwrite");
  assert.equal(hostPermissionForAction({ action: "delete", recursive: true }, 4), "files.deleteRecursive");
  assert.equal(hostPermissionForAction({ action: "run_shell", shell: "powershell" }, 5), "powershell.risk5");
  assert.equal(hostPermissionForAction({ action: "run_shell", shell: "cmd" }, 5), undefined);
  const migrated = hostPermissionsFromRiskLevels([true, false, true, false, false]);
  assert.equal(migrated["files.search"], true);
  assert.equal(migrated["files.read"], false);
  assert.equal(migrated["files.copyOverwrite"], true);
  assert.equal(migrated["files.moveOverwrite"], false);
  assert.equal(migrated["bash.risk3"], true);
});

test("host file actions and conversation process tracking work end to end", { skip: !isHostComputerAvailable() }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "neural-host-test-")); const session = `test:${crypto.randomUUID()}`;
  try {
    const original = path.join(root, "original.txt"); const copied = path.join(root, "copied.txt"); const moved = path.join(root, "moved.txt");
    await executeHostComputerTool(session, { action: "write_file", path: original, content: "hello", encoding: "utf8" });
    const read = await executeHostComputerTool(session, { action: "read_file", path: original }) as { result: { content: string } }; assert.equal(read.result.content, "hello");
    await executeHostComputerTool(session, { action: "copy", path: original, destination: copied });
    await executeHostComputerTool(session, { action: "move", path: copied, destination: moved }); assert.equal(await readFile(moved, "utf8"), "hello");
    await executeHostComputerTool(session, { action: "rename", path: moved, new_name: "renamed.txt" });
    const started = await executeHostComputerTool(session, { action: "start_process", program: process.execPath, arguments: ["-e", "setInterval(()=>{},1000)"], process_name: "host-test" }) as { result: { pid: number } };
    const listed = await executeHostComputerTool(session, { action: "list_processes" }) as { result: { processes: Array<{ pid: number; name: string }> } }; assert.deepEqual(listed.result.processes.map(item => [item.pid, item.name]), [[started.result.pid, "host-test"]]);
    await executeHostComputerTool(session, { action: "kill_process", pid: started.result.pid });
    const shell = await executeHostComputerTool(session, { action: "run_shell", shell: process.platform === "win32" ? "powershell" : "bash", command: process.platform === "win32" ? "Write-Output host-shell-ok" : "printf host-shell-ok" }) as { result: { exitCode: number; stdout: string } };
    assert.equal(shell.result.exitCode, 0); assert.match(shell.result.stdout, /host-shell-ok/);
    await executeHostComputerTool(session, { action: "delete", path: path.join(root, "renamed.txt") });
  } finally { closeHostComputerSession(session); await rm(root, { recursive: true, force: true }); }
});
