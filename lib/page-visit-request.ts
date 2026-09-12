import { APP_VERSION } from "./version.ts";

const browserPlatform = process.platform === "win32"
  ? "Windows NT 10.0; Win64; x64"
  : process.platform === "darwin"
    ? "Macintosh; Intel Mac OS X 10_15_7"
    : "X11; Linux x86_64";

export function pageVisitHeaders() {
  return {
    // Some public CDNs reject unknown bot-style agents before the origin sees the request.
    // Keep our product token while using the browser-compatible prefix those filters accept.
    "User-Agent": `Mozilla/5.0 (${browserPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 NeuralChat/${APP_VERSION}`,
    Accept: "text/html,text/plain,application/json,application/pdf,image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5",
    "Accept-Language": "en-US,en;q=0.9",
  };
}
