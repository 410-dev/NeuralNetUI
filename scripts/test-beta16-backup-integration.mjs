// Exercises every backup scope (personal, user, global, accounts) with both restore modes against
// a server that migrates a copied data directory on start. BACKUP_QA_SOURCE points at an existing
// data directory (for example a copy of an older installation); without it a fixture is generated.
// BACKUP_QA_APP_DIR runs a staged standalone package with BACKUP_QA_NODE instead of the source tree.
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { encryptBackup, decryptBackup } from "../lib/backup-crypto.ts";
const password="Backup-QA-Local-2026";
const credentialByImage=new Map();
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => createHash("sha256").update(value).digest("hex");
const root = await mkdtemp(path.join(os.tmpdir(), "neural-backup-qa-"));
const data = path.join(root, "data"), uploads = path.join(data, "uploads"), dbPath = path.join(data, "neural-chat.sqlite3");
const sevenZip = path.join(process.cwd(), "node_modules", "7zip-bin", process.platform === "win32" ? path.join("win", process.arch, "7za.exe") : path.join(process.platform === "darwin" ? "mac" : "linux", process.arch, "7za"));

// ---- Source data -----------------------------------------------------------------------------
const source = process.env.BACKUP_QA_SOURCE;
if (source) {
  mkdirSync(data, { recursive: true });
  const origin = new Database(path.join(source, "neural-chat.sqlite3"), { readonly: true, fileMustExist: true });
  await origin.backup(dbPath); origin.close();
  if (existsSync(path.join(source, "uploads"))) cpSync(path.join(source, "uploads"), uploads, { recursive: true });
} else {
  const init = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", "await import('./lib/database.ts')"], { env: { ...process.env, NEURAL_CHAT_DATA_DIR: data }, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const fixture = new Database(dbPath); mkdirSync(uploads, { recursive: true });
  const stamp = new Date().toISOString();
  const addUser = (username, role) => { const id = randomUUID(); fixture.prepare("INSERT INTO users(id,username,display_name,password_hash,role,preferences,storage_quota_bytes,trash_quota_bytes,storage_quota_uses_default,trash_quota_uses_default,plan_id,created_at,updated_at) VALUES(?,?,?,?,?,?,536870912,1073741824,1,1,'default-free',?,?)").run(id, username, `${username} name`, `scrypt$qa-salt$${scryptSync(password,"qa-salt",64).toString("hex")}`, role, JSON.stringify({ language: "ko" }), stamp, stamp); return id; };
  const addChat = (userId, { deleted = false, attachment } = {}) => {
    const id = randomUUID(), main = randomUUID(), fork = randomUUID(), first = randomUUID(), second = randomUUID(), third = randomUUID();
    fixture.prepare("INSERT INTO conversations(id,title,model_id,active_branch_id,created_at,updated_at,user_id,deleted_at) VALUES(?,?,?,?,?,?,?,?)").run(id, `chat ${id.slice(0, 4)}`, "qa-model", fork, stamp, stamp, userId, deleted ? stamp : null);
    for (const [message, role, content] of [[first, "user", "hello"], [second, "assistant", "hi"], [third, "assistant", "fork"]]) fixture.prepare("INSERT INTO messages(id,conversation_id,role,content,created_at,input_tokens,tool_events,steps) VALUES(?,?,?,?,?,?,?,?)").run(message, id, role, content, stamp, 3, role === "assistant" ? "[]" : null, role === "assistant" ? JSON.stringify([{ type: "text", text: content }]) : null);
    fixture.prepare("INSERT INTO branches(id,conversation_id,name,parent_branch_id,forked_from_message_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(main, id, "Main", null, null, 0, stamp, stamp);
    fixture.prepare("INSERT INTO branches(id,conversation_id,name,parent_branch_id,forked_from_message_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(fork, id, "Fork", main, second, 1, stamp, stamp);
    for (const [branch, message, position] of [[main, first, 0], [main, second, 1], [fork, first, 0], [fork, third, 1]]) fixture.prepare("INSERT INTO branch_messages(branch_id,message_id,position) VALUES(?,?,?)").run(branch, message, position);
    fixture.prepare("INSERT INTO context_summaries(branch_id,fingerprint,covered_count,summary) VALUES(?,?,?,?)").run(fork, "fp", 1, "summary");
    if (attachment) fixture.prepare("INSERT INTO message_attachments(message_id,upload_id,position) VALUES(?,?,0)").run(first, attachment);
  };
  const addUpload = (userId, deleted = false) => { const id = randomUUID(), bytes = randomBytes(4096 + Math.floor(Math.random() * 4096)); writeFileSync(path.join(uploads, `${id}.original`), bytes); writeFileSync(path.join(uploads, `${id}.thumbnail`), randomBytes(512)); fixture.prepare("INSERT INTO uploads(id,name,mime_type,size,width,height,created_at,user_id,retained,deleted_at) VALUES(?,?,?,?,?,?,?,?,1,?)").run(id, `${id}.png`, "image/png", bytes.length, 10, 10, stamp, userId, deleted ? stamp : null); return id; };
  fixture.transaction(() => {
    const owner = addUser("backupqa", "superadmin"), admin = addUser("backupadmin", "admin"), member = addUser("backupmember", "user");
    for (const userId of [owner, admin]) { addChat(userId, { attachment: addUpload(userId) }); addChat(userId, { deleted: true }); addUpload(userId, true); }
    addChat(member);
  })();
  fixture.close();
}

// ---- Sessions for the accounts under test ----------------------------------------------------
const setupDb = new Database(dbPath);
const migratedBefore = setupDb.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version;
const accountsBefore = setupDb.prepare("SELECT id,username,role,storage_quota_bytes,trash_quota_bytes,storage_quota_uses_default,trash_quota_uses_default FROM users ORDER BY id").all();
const pick = role => setupDb.prepare("SELECT id FROM users WHERE role=? ORDER BY (SELECT COUNT(*) FROM uploads WHERE user_id=users.id) DESC, created_at LIMIT 1").get(role)?.id;
const people = { owner: pick("superadmin"), admin: pick("admin"), member: pick("user") };
assert.ok(people.owner && people.admin && people.member, "the source needs a superadmin, an admin and a user");
const cookies = {};
const credentials={};
for(const [name,id] of Object.entries(people)){const username=setupDb.prepare("SELECT username FROM users WHERE id=?").get(id).username;credentials[name]={username,password};setupDb.prepare("UPDATE users SET password_hash=? WHERE id=?").run(`scrypt$qa-salt$${scryptSync(password,"qa-salt",64).toString("hex")}`,id);}
for (const [name, userId] of Object.entries(people)) { const token = randomBytes(32).toString("base64url"); setupDb.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)").run(randomUUID(), userId, sha(token), new Date(Date.now() + 86400_000).toISOString(), new Date().toISOString()); cookies[name] = `neural_chat_session=${token}`; }
setupDb.close();

// ---- Server ------------------------------------------------------------------------------------
const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening"); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`, appDir = process.env.BACKUP_QA_APP_DIR ? path.resolve(process.env.BACKUP_QA_APP_DIR) : process.cwd();
const server = spawn(process.env.BACKUP_QA_NODE || process.execPath, process.env.BACKUP_QA_APP_DIR ? ["server.js"] : ["scripts/start-server.mjs", "start"], { cwd: appDir, windowsHide: true, env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NEURAL_CHAT_DATA_DIR: data }, stdio: ["ignore", "pipe", "pipe"] });
let logs = ""; server.stdout.on("data", chunk => logs += chunk); server.stderr.on("data", chunk => logs += chunk);
const call = (who, route, method = "GET", body, headers = {}) => fetch(base + route, { method, headers: { cookie: cookies[who], "X-Backup-Credentials":encodeURIComponent(JSON.stringify(credentials[who])), ...(body !== undefined && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
const json = async (who, route, method, body) => { const response = await call(who, route, method, body); const value = await response.json().catch(() => ({})); assert.ok(response.ok, `${method || "GET"} ${route}: ${response.status} ${JSON.stringify(value)}`); return value; };
const image = async (who, query) => { const secret=query.scope==="user"?credentials[Object.keys(people).find(key=>people[key]===query.userId)]:credentials[who];const response = await call(who, `/api/backup?${new URLSearchParams(query)}`,"GET",undefined,{"X-Backup-Credentials":encodeURIComponent(JSON.stringify(secret))}); const bytes = new Uint8Array(await response.arrayBuffer()); assert.ok(response.ok, `backup ${JSON.stringify(query)}: ${Buffer.from(bytes).toString("utf8")}`); assert.equal(Buffer.from(bytes.subarray(0,8)).toString(),"NNUIENC1");credentialByImage.set(bytes,secret);return bytes; };
const restore = async (who, bytes, scope, mode, target, expected = 200) => { const response = await call(who, "/api/backup", "POST", bytes, { "Content-Type": "application/x-7z-compressed", "X-Backup-Credentials":encodeURIComponent(JSON.stringify(credentialByImage.get(bytes)||credentials[who])), "X-Backup-Scope": scope, "X-Restore-Mode": mode, ...(target ? { "X-Target-User-Id": target } : {}) }); const value = await response.json().catch(() => ({})); assert.equal(response.status, expected, `restore ${scope}/${mode}: ${JSON.stringify(value)}`); return value; };

// ---- Fingerprints read straight from SQLite and disk -------------------------------------------
const read = fn => { const connection = new Database(dbPath, { readonly: true }); try { return fn(connection); } finally { connection.close(); } };
function personalPrint(userId, { excludeConversations = [] } = {}) {
  return read(connection => {
    const rows = (sql, ...args) => connection.prepare(sql).all(...args);
    const conversations = rows("SELECT * FROM conversations WHERE user_id=? ORDER BY id", userId).filter(row => !excludeConversations.includes(row.id));
    const ids = conversations.map(row => row.id), marks = ids.map(() => "?").join(",") || "''";
    const uploadRows = rows("SELECT * FROM uploads WHERE user_id=? ORDER BY id", userId);
    const files = uploadRows.map(row => readdirSync(uploads).filter(name => name.startsWith(`${row.id}.`)).sort().map(name => `${name}:${sha(readFileSync(path.join(uploads, name)))}`));
    return sha(JSON.stringify({
      profile: connection.prepare("SELECT display_name,preferences FROM users WHERE id=?").get(userId), conversations,
      branches: rows(`SELECT * FROM branches WHERE conversation_id IN (${marks}) ORDER BY id`, ...ids),
      messages: rows(`SELECT * FROM messages WHERE conversation_id IN (${marks}) ORDER BY id`, ...ids),
      branchMessages: rows(`SELECT bm.* FROM branch_messages bm JOIN branches b ON b.id=bm.branch_id WHERE b.conversation_id IN (${marks}) ORDER BY bm.branch_id,bm.position`, ...ids),
      attachments: rows(`SELECT a.* FROM message_attachments a JOIN messages m ON m.id=a.message_id WHERE m.conversation_id IN (${marks}) ORDER BY a.message_id,a.position`, ...ids),
      summaries: rows(`SELECT s.* FROM context_summaries s JOIN branches b ON b.id=s.branch_id WHERE b.conversation_id IN (${marks}) ORDER BY s.branch_id`, ...ids),
      uploadRows, files,
    }));
  });
}
const accountsPrint = () => read(connection => sha(JSON.stringify(["SELECT id,username,display_name,password_hash,role,preferences,storage_quota_bytes,trash_quota_bytes,storage_quota_uses_default,trash_quota_uses_default,audit_enabled,plan_id,created_at FROM users ORDER BY id", "SELECT id,name,storage_quota_bytes,trash_quota_bytes,served_model_ids,model_weights,created_at FROM plans ORDER BY id", "SELECT * FROM plan_token_limits ORDER BY id", "SELECT * FROM reset_credits ORDER BY id"].map(sql => connection.prepare(sql).all()))));
const configValue = () => read(connection => JSON.parse(connection.prepare("SELECT value FROM app_config WHERE id=1").get().value));
const counts = userId => read(connection => ({ conversations: connection.prepare("SELECT COUNT(*) AS c FROM conversations WHERE user_id=?").get(userId).c, uploads: connection.prepare("SELECT COUNT(*) AS c FROM uploads WHERE user_id=?").get(userId).c }));
async function repack(bytes, edit, editData) {
  const work = path.join(root, `repack-${randomUUID()}`), archive = path.join(work, "in.7z"), unpacked = path.join(work, "x"), output = path.join(work, "out.7z");
  mkdirSync(unpacked, { recursive: true }); const encrypted=path.join(work,"in.nnbak");writeFileSync(encrypted,bytes);await decryptBackup(encrypted,archive,credentialByImage.get(bytes));
  assert.equal(spawnSync(sevenZip, ["x", "-y", `-o${unpacked}`, archive]).status, 0);
  const manifest = JSON.parse(readFileSync(path.join(unpacked, "manifest.json"), "utf8")); edit(manifest); writeFileSync(path.join(unpacked, "manifest.json"), JSON.stringify(manifest));
  if(editData){const dataFile=path.join(unpacked,"data.json"),value=JSON.parse(readFileSync(dataFile,"utf8"));editData(value);writeFileSync(dataFile,JSON.stringify(value));}
  assert.equal(spawnSync(sevenZip, ["a", "-t7z", output, "."], { cwd: unpacked }).status, 0);
  const result=path.join(work,"out.nnbak");await encryptBackup(output,result,credentialByImage.get(bytes));const updated=new Uint8Array(readFileSync(result));credentialByImage.set(updated,credentialByImage.get(bytes));return updated;
}

try {
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`${base}/api/auth/status`)).ok) break; } catch {} if (i === 299) throw new Error(`Server did not start.\n${logs}`); await delay(200); }

  // Upgrade: plans arrive without changing anyone's capacity.
  await json("owner", "/api/usage");
  const migrated = read(connection => ({ version: connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, plans: connection.prepare("SELECT * FROM plans").all(), users: connection.prepare("SELECT id,username,role,storage_quota_bytes,trash_quota_bytes,storage_quota_uses_default,trash_quota_uses_default,plan_id FROM users ORDER BY id").all(), config: JSON.parse(connection.prepare("SELECT value FROM app_config WHERE id=1").get()?.value || "{}") }));
  assert.equal(migrated.version, 19, `migrated from ${migratedBefore} to ${migrated.version}`);
  assert.ok(migrated.plans.length >= 1);
  if (migratedBefore < 16) { const settings = migrated.config.userStorageSettings || {}; const free = migrated.plans.find(plan => plan.id === "default-free"); assert.equal(free.storage_quota_bytes, settings.defaultQuotaBytes ?? 536870912); assert.equal(free.trash_quota_bytes, settings.defaultTrashQuotaBytes ?? 2 * free.storage_quota_bytes); }
  for (const user of migrated.users) { const before = accountsBefore.find(item => item.id === user.id); assert.deepEqual({ ...user, plan_id: undefined }, { ...before, plan_id: undefined }, `${user.username} keeps its account settings`); assert.ok(user.plan_id, `${user.username} has a plan`); }

  // Permissions.
  assert.equal((await call("member", "/api/backup?scope=global")).status, 403);
  assert.equal((await call("member", "/api/backup?scope=accounts")).status, 403);
  assert.equal((await call("member", `/api/backup?scope=user&userId=${people.owner}`)).status, 403);

  // Personal: replace restores exactly, merge keeps unrelated chats, replace drops them again.
  for (const who of ["owner", "member"]) {
    const userId = people[who], original = personalPrint(userId), bytes = await image(who, { scope: "personal" });
    await json(who, "/api/conversations", "DELETE", {});
    await restore(who, bytes, "personal", "replace");
    assert.equal(personalPrint(userId), original, `${who} personal replace`);
    const stamp = new Date().toISOString(), extra = `qa-extra-${randomUUID()}`, branch = `qa-branch-${randomUUID()}`;
    await json(who, "/api/conversations", "POST", { id: extra, title: "QA extra", modelId: "qa-model", activeBranchId: branch, createdAt: stamp, updatedAt: stamp, branches: [{ id: branch, name: "Main", createdAt: stamp, updatedAt: stamp, messages: [{ id: `qa-message-${randomUUID()}`, role: "user", content: "keep me", createdAt: stamp }] }] });
    await restore(who, bytes, "personal", "merge");
    assert.equal(personalPrint(userId, { excludeConversations: [extra] }), original, `${who} personal merge`);
    assert.ok(read(connection => connection.prepare("SELECT 1 FROM conversations WHERE id=?").get(extra)), `${who} merge keeps unrelated chats`);
    await restore(who, bytes, "personal", "replace");
    assert.equal(personalPrint(userId), original, `${who} personal replace after merge`);
  }

  // Per-user images, administered by another account; a foreign image cannot land on someone else.
  const adminOriginal = personalPrint(people.admin), adminImage = await image("owner", { scope: "user", userId: people.admin });
  await json("admin", "/api/conversations", "DELETE", {});
  await restore("owner", adminImage, "user", "replace", people.admin);
  assert.equal(personalPrint(people.admin), adminOriginal, "user replace");
  await restore("owner", adminImage, "user", "merge", people.admin);
  assert.equal(personalPrint(people.admin), adminOriginal, "user merge");
  if (counts(people.admin).conversations) await restore("owner", adminImage, "user", "merge", people.member);
  await restore("owner", adminImage, "personal", "merge");

  // Global settings.
  const configBefore = configValue(), globalImage = await image("owner", { scope: "global" });
  const edited = await json("owner", "/api/config"); edited.connections = [...edited.connections, { id: "qa-extra-connection", name: "QA extra", driver: "openai", baseUrl: "http://127.0.0.1:9/v1", apiKey: "", models: [] }];
  await json("owner", "/api/config", "PUT", edited);
  await restore("owner", globalImage, "global", "merge");
  const merged = configValue();
  assert.ok(merged.connections.some(item => item.id === "qa-extra-connection"), "global merge keeps unrelated connections");
  for (const connection of configBefore.connections) assert.deepEqual(merged.connections.find(item => item.id === connection.id), connection, "global merge restores image connections");
  await restore("owner", globalImage, "global", "replace");
  assert.deepEqual(configValue().connections, configBefore.connections, "global replace");
  assert.deepEqual(configValue().models, configBefore.models, "global replace models");

  // Account credentials: merge reverts changed rows and keeps new ones; replace removes new accounts,
  // including one whose chat still references its own upload (RESTRICT), and deletes that user's files.
  const accountsOriginal = accountsPrint(), accountsImage = await image("owner", { scope: "accounts" });
  const memberBefore = read(connection => connection.prepare("SELECT display_name FROM users WHERE id=?").get(people.member));
  await json("owner", `/api/users/${people.member}`, "PATCH", { displayName: "Renamed by QA" });
  const plan = (await json("owner", "/api/plans", "POST", { name: `QA plan ${randomUUID().slice(0, 6)}`, storageQuotaBytes: 4 * 1024 ** 3, servedModelIds: [], modelWeights: {}, tokenLimits: [{ durationSeconds: 3600, tokenLimit: 10, tokenScope: "both" }] })).plan;
  const extraName = `qaextra${randomUUID().slice(0, 6)}`;
  assert.equal((await call("owner", "/api/users", "POST", { username: extraName, displayName: "Extra", password: "Backup-QA-Local-2026" })).status, 201);
  const extraId = read(connection => connection.prepare("SELECT id FROM users WHERE username=?").get(extraName).id);
  const extraUpload = randomUUID();
  { const connection = new Database(dbPath); connection.pragma("busy_timeout = 5000"); const stamp = new Date().toISOString(), chat = randomUUID(), branch = randomUUID(), message = randomUUID(); writeFileSync(path.join(uploads, `${extraUpload}.original`), randomBytes(64)); connection.transaction(() => { connection.prepare("INSERT INTO uploads(id,name,mime_type,size,created_at,user_id,retained) VALUES(?,?,?,?,?,?,1)").run(extraUpload, "x.bin", "application/octet-stream", 64, stamp, extraId); connection.prepare("INSERT INTO conversations(id,title,model_id,active_branch_id,created_at,updated_at,user_id) VALUES(?,?,?,?,?,?,?)").run(chat, "extra", "qa-model", branch, stamp, stamp, extraId); connection.prepare("INSERT INTO branches(id,conversation_id,name,position,created_at,updated_at) VALUES(?,?,?,0,?,?)").run(branch, chat, "Main", stamp, stamp); connection.prepare("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?)").run(message, chat, "user", "x", stamp); connection.prepare("INSERT INTO branch_messages(branch_id,message_id,position) VALUES(?,?,0)").run(branch, message); connection.prepare("INSERT INTO message_attachments(message_id,upload_id,position) VALUES(?,?,0)").run(message, extraUpload); })(); connection.close(); }
  await restore("owner", accountsImage, "accounts", "merge");
  assert.equal(read(connection => connection.prepare("SELECT display_name FROM users WHERE id=?").get(people.member)).display_name, memberBefore.display_name, "accounts merge reverts changed accounts");
  assert.ok(read(connection => connection.prepare("SELECT 1 FROM users WHERE id=?").get(extraId)), "accounts merge keeps new accounts");
  assert.ok(read(connection => connection.prepare("SELECT 1 FROM plans WHERE id=?").get(plan.id)), "accounts merge keeps new plans");
  await restore("owner", accountsImage, "accounts", "replace");
  assert.equal(accountsPrint(), accountsOriginal, "accounts replace");
  assert.ok(!existsSync(path.join(uploads, `${extraUpload}.original`)), "removed accounts lose their files");
  // A different account now holding an imaged username is a readable conflict for merge, not a SQLite error.
  const memberName = read(connection => connection.prepare("SELECT username FROM users WHERE id=?").get(people.member).username);
  await json("owner", `/api/users/${people.member}`, "DELETE");
  assert.equal((await call("owner", "/api/users", "POST", { username: memberName, displayName: "Impostor", password: "Backup-QA-Local-2026" })).status, 201);
  await restore("owner", accountsImage, "accounts", "merge");
  assert.equal(read(connection=>connection.prepare("SELECT display_name FROM users WHERE username=?").get(memberName)).display_name,memberBefore.display_name,"matching usernames map to destination IDs");
  await restore("owner", accountsImage, "accounts", "replace");

  const beforeInvalid=accountsPrint();
  const bad=Buffer.from(accountsImage);bad[bad.length-1]^=1;
  await restore("owner",bad,"accounts","replace",undefined,400);
  assert.equal(accountsPrint(),beforeInvalid);
  const wrong=await call("owner","/api/backup","POST",accountsImage,{"X-Backup-Scope":"accounts","X-Restore-Mode":"replace","X-Backup-Credentials":encodeURIComponent(JSON.stringify({...credentials.owner,password:"wrong"}))});
  assert.equal(wrong.status,400);assert.equal(accountsPrint(),beforeInvalid);
  assert.equal((await call("admin","/api/backup","POST",accountsImage,{"X-Backup-Scope":"accounts"})).status,403);
  // Image versions and malformed input.
  await restore("owner", await repack(globalImage, manifest => { manifest.imageVersion = 99; }), "global", "merge", undefined, 400);
  await restore("owner", await repack(globalImage, manifest => { manifest.imageVersion = 0; }), "global", "merge");
  await restore("owner", globalImage, "accounts", "merge", undefined, 400);
  await restore("owner", new Uint8Array(randomBytes(512)), "global", "merge", undefined, 400);

  // A fresh independent installation has different user IDs and no source database.
  const destination=path.join(root,"destination");const destinationPort=port+1;
  const second=spawn(process.env.BACKUP_QA_NODE||process.execPath,process.env.BACKUP_QA_APP_DIR?["server.js"]:["scripts/start-server.mjs","start"],{cwd:appDir,windowsHide:true,env:{...process.env,HOSTNAME:"127.0.0.1",PORT:String(destinationPort),NEURAL_CHAT_DATA_DIR:destination},stdio:["ignore","pipe","pipe"]});
  second.stdout.on("data",chunk=>logs+=chunk);second.stderr.on("data",chunk=>logs+=chunk);
  try{
    const url=`http://127.0.0.1:${destinationPort}`;for(let i=0;i<300;i++){try{if((await fetch(`${url}/api/auth/status`)).ok)break;}catch{}await delay(100);}
    const setup=await fetch(`${url}/api/auth/setup`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"destination",password,displayName:"Destination owner"})});assert.equal(setup.status,201);const cookie=setup.headers.get("set-cookie").split(";")[0];
    const invalidPersonal=await repack(adminImage,()=>{},value=>value.tables.branches.push({...value.tables.branches[0]}));
    const rollback=await fetch(`${url}/api/backup`,{method:"POST",headers:{cookie,"X-Backup-Scope":"personal","X-Restore-Mode":"replace","X-Backup-Credentials":encodeURIComponent(JSON.stringify(credentialByImage.get(adminImage)))},body:invalidPersonal});assert.equal(rollback.status,500,"constraint failure rolls back staged files and rows");
    assert.deepEqual(readdirSync(path.join(destination,"uploads")),[],"failed restore leaves no new or staged files");
    const rollbackDb=new Database(path.join(destination,"neural-chat.sqlite3"),{readonly:true});assert.equal(rollbackDb.prepare("SELECT COUNT(*) AS n FROM conversations").get().n,0);rollbackDb.close();
    for(const [bytes,scope] of [[adminImage,"personal"],[globalImage,"global"],[accountsImage,"accounts"]])for(const mode of ["merge","replace"]){const response=await fetch(`${url}/api/backup`,{method:"POST",headers:{cookie,"X-Backup-Scope":scope,"X-Restore-Mode":mode,"X-Backup-Credentials":encodeURIComponent(JSON.stringify(credentialByImage.get(bytes)))},body:bytes});assert.equal(response.status,200,await response.text());}
    const destDb=new Database(path.join(destination,"neural-chat.sqlite3"),{readonly:true});
    const local=destDb.prepare("SELECT id,role FROM users WHERE username='destination'").get();assert.equal(local.role,"superadmin");assert.notEqual(local.id,people.owner);
    assert.equal(destDb.prepare("SELECT COUNT(*) AS n FROM conversations WHERE user_id=?").get(local.id).n,counts(people.admin).conversations);
    assert.deepEqual(destDb.pragma("foreign_key_check"),[]);
    const destFiles=destDb.prepare("SELECT id,size FROM uploads WHERE user_id=?").all(local.id);for(const file of destFiles)assert.equal(readFileSync(path.join(destination,"uploads",`${file.id}.original`)).length,file.size);
    destDb.close();
    const login=await fetch(`${url}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(credentials.owner)});assert.equal(login.status,200,"restored source account can sign in on destination");
    if(process.env.BACKUP_QA_KEEP){writeFileSync(path.join(process.cwd(),".backup-qa.json"),JSON.stringify({url,cookie,root}));console.log(`QA destination ready: ${url}`);await new Promise(resolve=>process.once("SIGINT",resolve));}
  }finally{second.kill();await once(second,"exit").catch(()=>{});}

  const serverErrors = logs.split(/\r?\n/).filter(line => /EACCES|FOREIGN KEY|SQLITE_|Unhandled|TypeError/.test(line));
  assert.deepEqual(serverErrors, [], "server log is clean");
  console.log(`Beta 16 encrypted backup integration passed (${source ? "source data" : "fixture"}, schema ${migratedBefore} -> 19).`);
} finally {
  server.kill(); await once(server, "exit").catch(() => {});
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
