import type { NextConfig } from "next";

// The backup route resolves 7-Zip at run time; trace only the binary for the platform being built.
const sevenZipBinary = process.platform === "win32" ? `win/${process.arch}/7za.exe` : `${process.platform === "darwin" ? "mac" : "linux"}/${process.arch}/7za`;

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/playwright-core/**/*"],
    "/api/backup": ["./node_modules/7zip-bin/index.js", "./node_modules/7zip-bin/package.json", `./node_modules/7zip-bin/${sevenZipBinary}`],
  },
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./installer/**/*"],
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [{ key: "Permissions-Policy", value: "geolocation=(self)" }],
    }];
  },
};

export default nextConfig;
