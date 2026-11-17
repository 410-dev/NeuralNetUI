"""YouTube subtitle MCP server for NeuralNetUI.

Streamable HTTP at /mcp, protected by the API key in config.json (sent as `Authorization: Bearer <key>` or
`X-API-Key: <key>`). On first start, a missing key is generated and written to config.json.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import sys
import time
from urllib.parse import quote, unquote
from pathlib import Path
from typing import Annotated, Any

import anyio
import uvicorn
import yt_dlp
from mcp.server.mcpserver import Context, MCPServer
from mcp.types import ResourceLink, TextContent
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field

from downloads import DownloadStore, estimated_size, format_selector
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
    # Video downloads: where files wait until NeuralNetUI has stored them, how long at most, and the size limit.
    "download_dir": "/downloads",
    "download_ttl_minutes": 120,
    "max_download_bytes": 8 * 1024 ** 3,
    # Optional public base URL of this server (e.g. https://yt.example.com) for the links it returns.
    "public_base_url": "",
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
    instructions=("Fetches the subtitles of a YouTube video as plain text so the assistant can read, quote or summarize it, "
                  "and downloads a video into the user's private NeuralNetUI storage when asked to."),
)
STORE = DownloadStore(CONFIG["download_dir"], CONFIG["download_ttl_minutes"])
DOWNLOAD_SLOTS = anyio.Semaphore(2)


def human_size(size: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return f"{size:.1f} GB"


class Reporter:
    """Progress notifications from the download thread. NeuralNetUI resets its timeout on each one, so the
    values only ever increase and a heartbeat keeps them coming through silent steps (merging, hashing)."""

    HEARTBEAT_SECONDS = 2  # well under the shortest NeuralNetUI tool timeout (5 s)

    def __init__(self, ctx: Context):
        self.ctx, self.value, self.sent_at, self.message = ctx, 0.0, 0.0, "Starting"
        # Set when the caller goes away; the download thread stops at its next progress update.
        self.cancelled = False

    async def send(self, value: float, total: float | None, message: str) -> None:
        self.value = max(self.value + 1, value)
        self.sent_at, self.message = time.monotonic(), message
        await self.ctx.report_progress(self.value, total, message)

    def from_thread(self, value: float, total: float | None, message: str, force: bool = False) -> None:
        if self.cancelled:
            raise yt_dlp.utils.DownloadCancelled("The caller stopped waiting for this download.")
        if force or time.monotonic() - self.sent_at >= 1:
            try:
                anyio.from_thread.run(self.send, value, total, message)
            except Exception:
                # The request is gone (cancelled or disconnected); stop the download instead of finishing it unseen.
                self.cancelled = True
                raise yt_dlp.utils.DownloadCancelled("The caller stopped waiting for this download.") from None

    async def heartbeat(self) -> None:
        while True:
            await anyio.sleep(0.5)
            if time.monotonic() - self.sent_at >= self.HEARTBEAT_SECONDS:
                await self.send(self.value + 1, None, self.message)


def download_video(url: str, max_height: int | None, reporter: Reporter) -> tuple[str, Path, dict[str, Any], dict[str, Any]]:
    canonical, _video_id = video_url(url)
    STORE.cleanup()
    limit = int(CONFIG.get("max_download_bytes") or DEFAULTS["max_download_bytes"])
    token, folder = STORE.new_folder()
    try:
        def on_progress(status: dict[str, Any]) -> None:
            if status.get("status") == "downloading":
                done = float(status.get("downloaded_bytes") or 0)
                total = status.get("total_bytes") or status.get("total_bytes_estimate")
                reporter.from_thread(done, float(total) if total else None, f"Downloading {human_size(done)}" + (f" / {human_size(float(total))}" if total else ""))
            elif status.get("status") == "finished":
                reporter.from_thread(reporter.value, None, "Download finished, preparing the file", force=True)

        def on_postprocess(status: dict[str, Any]) -> None:
            if status.get("status") == "started":
                reporter.from_thread(reporter.value, None, f"{status.get('postprocessor', 'Processing')} running", force=True)

        options = {**ydl_options(), "skip_download": False, "format": format_selector(max_height), "outtmpl": str(folder / "%(title).150B [%(id)s].%(ext)s"),
                   "writesubtitles": False, "writeautomaticsub": False, "noprogress": True, "max_filesize": limit,
                   "progress_hooks": [on_progress], "postprocessor_hooks": [on_postprocess]}
        with yt_dlp.YoutubeDL(options) as ydl:
            try:
                info = ydl.extract_info(canonical, download=False) or {}
            except yt_dlp.utils.DownloadError as error:
                raise SubtitleError(f"YouTube did not return this video: {str(error).removeprefix('ERROR: ').strip()}") from None
            expected = estimated_size(info)
            if expected and expected > limit:
                raise SubtitleError(f"The video is about {human_size(expected)}, over this server's {human_size(limit)} download limit. Ask for a lower max_height.")
            if expected and STORE.free_bytes() < expected * 1.2 + 512 * 1024 ** 2:
                raise SubtitleError("This server does not have enough free disk space for the video right now.")
            try:
                info = ydl.process_ie_result(info, download=True) or info
            except yt_dlp.utils.DownloadCancelled:
                raise SubtitleError("The download was stopped because the caller stopped waiting.") from None
            except yt_dlp.utils.DownloadError as error:
                raise SubtitleError(f"The download failed: {str(error).removeprefix('ERROR: ').strip()}") from None
        files = [Path(item["filepath"]) for item in info.get("requested_downloads") or [] if item.get("filepath")]
        file = files[0] if files else None
        if not file or not file.is_file():
            raise SubtitleError("The download did not produce a file (it may have been over the size limit).")
        if file.stat().st_size > limit:
            raise SubtitleError(f"The file is {human_size(file.stat().st_size)}, over this server's {human_size(limit)} download limit.")
        reporter.from_thread(reporter.value, None, "Checking the file", force=True)
        digest = hashlib.sha256()
        with file.open("rb") as handle:
            for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
                digest.update(chunk)
        meta = STORE.remember(token, file, digest.hexdigest())
        return token, file, meta, info
    except BaseException:
        STORE.discard(token)
        raise


@server.tool(
    description=(
        "Download a YouTube video and save it to the user's private NeuralNetUI storage. Use it only when the user asks "
        "for the video file itself. By default it takes the best available video and audio quality, without subtitles. "
        "Large videos can take several minutes; the reply says where the file was saved."
    ),
    structured_output=False,
)
async def download_youtube_video(
    url: Annotated[str, Field(description="YouTube video link (youtube.com/watch, youtu.be, shorts, live) or an 11-character video id.")],
    ctx: Context,
    max_height: Annotated[int | None, Field(ge=144, le=4320, description="Optional resolution cap in pixels, e.g. 1080. Leave empty for the best available.")] = None,
) -> list[TextContent | ResourceLink]:
    reporter = Reporter(ctx)
    async with DOWNLOAD_SLOTS:
        await reporter.send(0, None, "Looking up the video")
        failure: SubtitleError | None = None
        async with anyio.create_task_group() as group:
            group.start_soon(reporter.heartbeat)
            try:
                token, file, meta, info = await anyio.to_thread.run_sync(download_video, url, max_height, reporter, abandon_on_cancel=True)
            except SubtitleError as error:
                failure = error
            except BaseException:
                reporter.cancelled = True
                raise
            finally:
                group.cancel_scope.cancel()
        if failure:
            raise ToolError(str(failure)) from None
    relative = f"files/{token}/{quote(file.name)}"
    base = str(CONFIG.get("public_base_url") or "").rstrip("/") or "http://localhost"
    summary = "\n".join([
        f"Downloaded: {info.get('title') or file.stem}",
        f"Channel: {info.get('channel') or info.get('uploader') or '(unknown)'}",
        f"Resolution: {info.get('resolution') or 'audio only'}; format: {info.get('format_id')}; size: {human_size(meta['size'])}",
        "The file follows as a link that NeuralNetUI saves into the user's private storage.",
    ])
    link = ResourceLink(type="resource_link", uri=f"{base}/{relative}", name=file.name, mimeType=meta["mimeType"], size=meta["size"],
                        _meta={"nnui/saveToStorage": True, "nnui/path": relative, "sha256": meta["sha256"]})
    return [TextContent(type="text", text=summary), link]


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
        if scope["path"].startswith("/files/"):
            return await serve_file(scope, send)
        return await self.app(scope, receive, send)


async def serve_file(scope, send) -> None:
    """GET streams a finished download; DELETE removes it once NeuralNetUI has stored it."""
    parts = scope["path"].split("/")
    token = parts[2] if len(parts) > 2 else ""
    if scope["method"] == "DELETE":
        return await json_response(200 if STORE.discard(token) else 404, {"deleted": True})(send)
    if scope["method"] not in ("GET", "HEAD"):
        return await json_response(405, {"error": "Method not allowed."})(send)
    STORE.cleanup()
    found = STORE.find(token)
    if not found or (len(parts) > 3 and unquote(parts[3]) != found[0].name):
        return await json_response(404, {"error": "The file is not available (it may have expired)."})(send)
    file, meta = found
    disposition = f"attachment; filename*=UTF-8''{quote(file.name)}".encode()
    await send({"type": "http.response.start", "status": 200, "headers": [
        (b"content-type", str(meta["mimeType"]).encode()), (b"content-length", str(file.stat().st_size).encode()),
        (b"content-disposition", disposition), (b"x-content-sha256", str(meta["sha256"]).encode()), (b"cache-control", b"no-store")]})
    if scope["method"] == "HEAD":
        return await send({"type": "http.response.body", "body": b""})
    async with await anyio.open_file(file, "rb") as handle:
        while chunk := await handle.read(1024 * 1024):
            await send({"type": "http.response.body", "body": chunk, "more_body": True})
    await send({"type": "http.response.body", "body": b""})


def main() -> None:
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr, format="%(levelname)s %(name)s: %(message)s")
    app = server.streamable_http_app(
        streamable_http_path="/mcp",
        # Each request stands alone. Replies stream as server-sent events so long calls can report progress, which
        # also keeps NeuralNetUI's timeout from firing while a download is still moving.
        stateless_http=True,
        json_response=False,
        # Access is controlled by the API key; the Host header differs behind proxies, so it is not checked.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
        host=str(CONFIG["host"]),
    )
    uvicorn.run(ApiKeyGate(app, str(CONFIG["api_key"])), host=str(CONFIG["host"]), port=int(CONFIG["port"]),
                log_level="warning", proxy_headers=True, forwarded_allow_ips="*")


if __name__ == "__main__":
    main()
