import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;
const appRoot = process.cwd();

function validPort(value, source) {
  const port = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${source} must be an integer between 1 and 65535.`);
  }
  return port;
}

function validHost(value, source) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${source} must be a non-empty string.`);
  }
  return value.trim();
}

async function loadServerConfig() {
  const configPath = path.resolve(process.env.NEURAL_CHAT_SERVER_CONFIG || path.join(appRoot, "app-config.json"));
  let document = {};
  try {
    document = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`Unable to read server config at ${configPath}: ${error.message}`);
  }

  const server = document?.server;
  if (server !== undefined && (typeof server !== "object" || server === null || Array.isArray(server))) {
    throw new Error(`server in ${configPath} must be an object.`);
  }

  const configuredHost = server?.host === undefined ? DEFAULT_HOST : validHost(server.host, "server.host");
  const configuredPort = server?.port === undefined ? DEFAULT_PORT : validPort(server.port, "server.port");
  return {
    configPath,
    host: process.env.NEURAL_CHAT_HOST
      ? validHost(process.env.NEURAL_CHAT_HOST, "NEURAL_CHAT_HOST")
      : configuredHost,
    port: process.env.PORT ? validPort(process.env.PORT, "PORT") : configuredPort,
  };
}

async function main() {
  const mode = process.argv[2] || "start";
  if (!["dev", "start", "--check"].includes(mode)) {
    throw new Error(`Unknown server mode: ${mode}`);
  }

  const config = await loadServerConfig();
  if (mode === "--check") {
    console.log(`Server config is valid: http://${config.host}:${config.port} (${config.configPath})`);
    return;
  }

  const entry = mode === "dev"
    ? path.join(appRoot, "node_modules", "next", "dist", "bin", "next")
    : path.join(appRoot, ".next", "standalone", "server.js");
  const args = mode === "dev"
    ? [process.execPath, entry, "dev", "--hostname", config.host, "--port", String(config.port)]
    : [process.execPath, entry];

  process.env.HOSTNAME = config.host;
  process.env.PORT = String(config.port);
  process.argv = args;
  console.log(`Neural Chat is starting at http://${config.host}:${config.port}`);
  createRequire(import.meta.url)(entry);
}

main().catch((error) => {
  console.error(`[ERROR] ${error.message}`);
  process.exitCode = 1;
});
