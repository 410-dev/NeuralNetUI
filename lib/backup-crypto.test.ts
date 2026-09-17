import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encryptBackup, decryptBackup } from "./backup-crypto.ts";

test("portable authenticated backups reject wrong credentials, tampering and truncation without plaintext residue", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "backup-crypto-test-"));
  const source = path.join(dir, "source"), encrypted = path.join(dir, "encrypted"), output = path.join(dir, "output");
  const credentials = { username: "Owner", password: "한글-password-2026" };
  try {
    const content = Buffer.alloc(128 * 1024, "private-data"); await writeFile(source, content);
    await encryptBackup(source, encrypted, credentials);
    const bytes = await readFile(encrypted); assert.ok(!bytes.includes(Buffer.from("private-data")));
    await decryptBackup(encrypted, output, { ...credentials, username: "owner" });
    assert.deepEqual(await readFile(output), content); await rm(output);
    for (const invalid of [{ ...credentials, password: "incorrect" }, { ...credentials, username: "other" }]) {
      await assert.rejects(decryptBackup(encrypted, output, invalid)); await assert.rejects(access(output));
    }
    for (const position of [10, 30, 100, bytes.length - 1]) {
      const corrupt = Buffer.from(bytes); corrupt[position] ^= 1; await writeFile(encrypted, corrupt);
      await assert.rejects(decryptBackup(encrypted, output, credentials)); await assert.rejects(access(output));
    }
    await writeFile(encrypted, bytes.subarray(0, 40)); await assert.rejects(decryptBackup(encrypted, output, credentials));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
