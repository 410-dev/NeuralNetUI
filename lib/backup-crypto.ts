import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, open, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

export type BackupCredentials = { username: string; password: string };
const magic = Buffer.from("NNUIENC1");
const headerSize = 36; // magic, 16-byte salt, 12-byte GCM nonce
export function validateCredentials(value: unknown): BackupCredentials {
  const credentials = value as BackupCredentials | undefined;
  if (!credentials || typeof credentials.username !== "string" || !/^[a-zA-Z0-9._-]{3,40}$/.test(credentials.username.trim()) || typeof credentials.password !== "string" || !credentials.password.length || credentials.password.length > 200) {
    throw Object.assign(new Error("백업 소유자의 아이디와 비밀번호를 입력해 주세요."), { status: 400 });
  }
  return { username: credentials.username.trim().toLowerCase(), password: credentials.password };
}
function derive(credentials: BackupCredentials, salt: Buffer): Promise<Buffer> {
  const input = JSON.stringify([credentials.username, credentials.password]);
  return new Promise((resolve, reject) => scrypt(input, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 ** 2 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function encryptBackup(source: string, destination: string, value: BackupCredentials) {
  const credentials = validateCredentials(value);
  const header = Buffer.concat([magic, randomBytes(16), randomBytes(12)]);
  const key = await derive(credentials, header.subarray(8, 24));
  try {
    const cipher = createCipheriv("aes-256-gcm", key, header.subarray(24));
    cipher.setAAD(header);
    await writeFile(destination, header, { flag: "wx", mode: 0o600 });
    await pipeline(createReadStream(source), cipher, createWriteStream(destination, { flags: "a" }));
    await appendFile(destination, cipher.getAuthTag());
  } catch (error) { await rm(destination, { force: true }); throw error; }
  finally { key.fill(0); }
}
export async function decryptBackup(source: string, destination: string, value: BackupCredentials) {
  const credentials = validateCredentials(value);
  const size = (await stat(source)).size;
  const header = Buffer.alloc(headerSize), tag = Buffer.alloc(16);
  const file = await open(source, "r");
  try {
    if (size <= headerSize + 16) throw Object.assign(new Error("백업 이미지가 잘렸거나 올바르지 않습니다."), { status: 400 });
    await file.read(header, 0, header.length, 0);
    await file.read(tag, 0, tag.length, size - tag.length);
  } finally { await file.close(); }
  if (!header.subarray(0, 8).equals(magic)) throw Object.assign(new Error("암호화된 베타 16 백업이 아닙니다. 이전 백업은 원본 인스턴스에서 다시 생성해 주세요."), { status: 400 });
  const key = await derive(credentials, header.subarray(8, 24));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(24));
    decipher.setAAD(header); decipher.setAuthTag(tag);
    await pipeline(createReadStream(source, { start: headerSize, end: size - 17 }), decipher, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  } catch {
    await rm(destination, { force: true });
    throw Object.assign(new Error("백업 당시의 아이디·비밀번호가 일치하지 않거나 파일이 손상되었습니다."), { status: 400 });
  } finally { key.fill(0); }
}
