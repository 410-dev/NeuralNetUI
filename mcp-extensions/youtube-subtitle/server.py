"""YouTube subtitle MCP server for NeuralNetUI.

Streamable HTTP at /mcp, protected by the API key in config.json (sent as `Authorization: Bearer <key>` or
`X-API-Key: <key>`). On first start, a missing key is generated and written to config.json.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import sys
from pathlib import Path
from typing import Annotated, Any

import anyio
import uvicorn
import yt_dlp
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field

from subtitles import (
    SubtitleError, choose_track, clock, languages_summary, page, parse_subtitles, pick_format, transcript_text, video_url,
)

VERSION = "1.0.0"
CONFIG_PATH = Path(os.environ.get("YOUTUBE_SUBTITLE_CONFIG", "/config/config.json"))
DEFAULTS: dict[str, Any] = {
    "api_key": "",
    "host": "0.0.0.0",
    "port": 8080,
    # Characters returned per call; the model pages through longer transcripts with `offset`.
    "max_chars": 60000,
    # Uploaded subtitles in these languages are preferred when the spoken language has none.
    "preferred_languages": ["ko", "en"],
    # Optional Netscape cookies file (inside the container) for videos YouTube only shows to signed-in viewers.
    "cookies_file": "",
    # Optional proxy URL for yt-dlp, e.g. when the server's IP is rate-limited by YouTube.
    "proxy": "",
}
log = logging.getLogger("youtube-subtitle")


def load_config() -> dict[str, Any]:
    stored: dict[str, Any] = {}
    if CONFIG_PATH.exists():
        stored = json.loads(CONFIG_PATH.read_text("utf-8"))
    config = {**DEFAULTS, **stored}
    if not str(config.get("api_key") or "").strip():
        config["api_key"] = secrets.token_hex(32)
        try:
            CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            CONFIG_PATH.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", "utf-8")
        except OSError as error:
            raise SystemExit(f"[youtube-subtitle] Cannot write {CONFIG_PATH} ({error.strerror}). Create the config folder "
                             "on the host first (mkdir -p config) so the container user can write to it.") from None
        try:
            os.chmod(CONFIG_PATH, 0o600)
        except OSError:
            pass
        print(f"[youtube-subtitle] Generated a new API key in {CONFIG_PATH}. Copy its api_key into NeuralNetUI "
              "(MCP connection, authentication: API Key).", flush=True)
    return config


CONFIG = load_config()


def ydl_options() -> dict[str, Any]:
    options: dict[str, Any] = {
        "skip_download": True, "quiet": True, "no_warnings": True, "noplaylist": True,
        "socket_timeout": 20, "retries": 2, "logger": log,
    }
    if CONFIG.get("cookies_file"):
        options["cookiefile"] = CONFIG["cookies_file"]
    if CONFIG.get("proxy"):
        options["proxy"] = CONFIG["proxy"]
    return options


def fetch(url: str) -> tuple[dict[str, Any], yt_dlp.YoutubeDL]:
    ydl = yt_dlp.YoutubeDL(ydl_options())
    try:
        info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as error:
        ydl.close()
        message = str(error).removeprefix("ERROR: ").strip()
        raise SubtitleError(f"YouTube did not return this video: {message}") from None
    return info or {}, ydl


def header(info: dict[str, Any], canonical: str) -> list[str]:
    lines = [f"Title: {info.get('title') or '(unknown)'}", f"Channel: {info.get('channel') or info.get('uploader') or '(unknown)'}"]
    if info.get("duration"):
        lines.append(f"Duration: {clock(int(info['duration']) * 1000)}")
    if info.get("upload_date"):
        date = str(info["upload_date"])
        lines.append(f"Uploaded: {date[:4]}-{date[4:6]}-{date[6:]}")
    lines.append(f"URL: {canonical}")
    return lines


def subtitles_for(url: str, language: str, timestamps: bool, offset: int) -> str:
    canonical, _video_id = video_url(url)
    info, ydl = fetch(canonical)
    try:
        track = choose_track(info, language.strip(), list(CONFIG.get("preferred_languages") or []))
        chosen = pick_format(track)
        try:
            raw = ydl.urlopen(chosen["url"]).read().decode("utf-8", "replace")
        except Exception as error:  # yt-dlp raises several network error types
            raise SubtitleError(f"The subtitle file could not be downloaded: {error}") from None
    finally:
        ydl.close()
    text = transcript_text(parse_subtitles(raw, chosen.get("ext", "")), timestamps)
    if not text:
        raise SubtitleError("The subtitle track is empty.")
    window, next_offset = page(text, offset, int(CONFIG.get("max_chars") or DEFAULTS["max_chars"]))
    kind = "uploaded subtitles" if track.kind == "manual" else "automatic captions, machine-translated" if track.translated else "automatic captions"
    lines = header(info, canonical) + [f"Subtitles: {track.language} ({kind})"]
    lines.append(f"Characters {offset}–{offset + len(window)} of {len(text)}"
                 + (f"; call again with offset={next_offset} for the rest" if next_offset is not None else "; this is the end"))
    return "\n".join(lines) + "\n\n" + window


def languages_for(url: str) -> str:
    canonical, _video_id = video_url(url)
    info, ydl = fetch(canonical)
    ydl.close()
    summary = languages_summary(info)
    lines = header(info, canonical)
    lines.append(f"Spoken language: {info.get('language') or ', '.join(summary['auto_spoken']) or 'unknown'}")
    lines.append(f"Uploaded subtitles: {', '.join(summary['manual']) or 'none'}")
    lines.append(f"Automatic captions (spoken language): {', '.join(summary['auto_spoken']) or 'none'}")
    lines.append(f"Machine-translated automatic captions: {summary['auto_translated']} languages")
    return "\n".join(lines)


server = MCPServer(
    name="youtube-subtitle",
    version=VERSION,
    instructions="Fetches the subtitles of a YouTube video as plain text so the assistant can read, quote or summarize it.",
)


@server.tool(
    description=(
        "Get the subtitles of one YouTube video as plain text, with its title, channel and length. Use it when the user "
        "shares a YouTube link and wants a summary, quotes or answers about the video. Uploaded subtitles are preferred, "
        "then automatic captions in the spoken language. Long transcripts come in pages: when the reply says to call "
        "again with an offset, do so before summarizing the whole video."
    ),
    structured_output=False,
)
async def get_youtube_subtitles(
    url: Annotated[str, Field(description="YouTube video link (youtube.com/watch, youtu.be, shorts, live) or an 11-character video id.")],
    language: Annotated[str, Field(description='Optional language code such as "ko" or "en". Leave empty to pick the best available track.')] = "",
    include_timestamps: Annotated[bool, Field(description="Start each paragraph with its time, e.g. [3:05], for questions about when something is said.")] = False,
    offset: Annotated[int, Field(ge=0, description="Character offset of the next page of a long transcript, exactly as given in the previous reply.")] = 0,
) -> str:
    try:
        return await anyio.to_thread.run_sync(subtitles_for, url, language, include_timestamps, max(0, int(offset)))
    except SubtitleError as error:
        raise ToolError(str(error)) from None


@server.tool(
    description="List the subtitle languages a YouTube video offers: uploaded subtitles and automatic captions.",
    structured_output=False,
)
async def list_youtube_subtitles(
    url: Annotated[str, Field(description="YouTube video link or an 11-character video id.")],
) -> str:
    try:
        return await anyio.to_thread.run_sync(languages_for, url)
    except SubtitleError as error:
        raise ToolError(str(error)) from None


def json_response(status: int, body: dict[str, Any], extra: list[tuple[bytes, bytes]] | None = None):
    payload = json.dumps(body).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode()), *(extra or [])]

    async def respond(send):
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": payload})
    return respond


class ApiKeyGate:
    """Lets requests through only with the configured key. /health answers without one, for container checks."""

    def __init__(self, app, key: str):
        self.app, self.key = app, key.encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if scope["path"] == "/health":
            return await json_response(200, {"ok": True, "version": VERSION})(send)
        headers = dict(scope["headers"])
        authorization = headers.get(b"authorization", b"")
        supplied = authorization[7:].strip() if authorization[:7].lower() == b"bearer " else headers.get(b"x-api-key", b"").strip()
        if not supplied or not secrets.compare_digest(supplied, self.key):
            return await json_response(401, {"error": "A valid API key is required."}, [(b"www-authenticate", b'Bearer realm="youtube-subtitle"')])(send)
        return await self.app(scope, receive, send)


def main() -> None:
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr, format="%(levelname)s %(name)s: %(message)s")
    app = server.streamable_http_app(
        streamable_http_path="/mcp",
        # Each request stands alone and answers with JSON, which proxies and tunnels pass through without buffering issues.
        stateless_http=True,
        json_response=True,
        # Access is controlled by the API key; the Host header differs behind proxies, so it is not checked.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
        host=str(CONFIG["host"]),
    )
    uvicorn.run(ApiKeyGate(app, str(CONFIG["api_key"])), host=str(CONFIG["host"]), port=int(CONFIG["port"]),
                log_level="warning", proxy_headers=True, forwarded_allow_ips="*")


if __name__ == "__main__":
    main()
