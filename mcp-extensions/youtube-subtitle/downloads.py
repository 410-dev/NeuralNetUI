"""Downloaded videos waiting to be fetched by NeuralNetUI.

Each download lives in its own folder named by a random token under the download directory, next to a meta.json. The
folder is removed when NeuralNetUI confirms it has stored the file (DELETE), or once it is older than the TTL.
"""

from __future__ import annotations

import json
import mimetypes
import re
import secrets
import shutil
import time
from pathlib import Path
from typing import Any

TOKEN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
EXTRA_TYPES = {".mkv": "video/x-matroska", ".webm": "video/webm", ".mp4": "video/mp4", ".m4a": "audio/mp4", ".opus": "audio/ogg", ".mp3": "audio/mpeg"}


def mime_type(name: str) -> str:
    suffix = Path(name).suffix.lower()
    return EXTRA_TYPES.get(suffix) or mimetypes.guess_type(name)[0] or "application/octet-stream"


class DownloadStore:
    def __init__(self, root: str | Path, ttl_minutes: float):
        self.root = Path(root)
        self.ttl_seconds = max(60.0, float(ttl_minutes) * 60)

    def new_folder(self) -> tuple[str, Path]:
        self.root.mkdir(parents=True, exist_ok=True)
        token = secrets.token_urlsafe(24)
        folder = self.root / token
        folder.mkdir(mode=0o700)
        return token, folder

    def remember(self, token: str, file: Path, sha256: str) -> dict[str, Any]:
        meta = {"name": file.name, "size": file.stat().st_size, "sha256": sha256, "mimeType": mime_type(file.name), "createdAt": time.time()}
        (self.root / token / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), "utf-8")
        return meta

    def find(self, token: str) -> tuple[Path, dict[str, Any]] | None:
        if not TOKEN.match(token):
            return None
        folder = self.root / token
        try:
            meta = json.loads((folder / "meta.json").read_text("utf-8"))
        except (OSError, ValueError):
            return None
        file = folder / str(meta.get("name", ""))
        # The stored name is used as a path segment only inside the token folder.
        if file.parent != folder or not file.is_file():
            return None
        return file, meta

    def discard(self, token: str) -> bool:
        if not TOKEN.match(token):
            return False
        folder = self.root / token
        existed = folder.is_dir()
        shutil.rmtree(folder, ignore_errors=True)
        return existed

    def cleanup(self, now: float | None = None) -> int:
        """Removes expired downloads and unfinished folders older than the TTL."""
        if not self.root.is_dir():
            return 0
        cutoff = (now or time.time()) - self.ttl_seconds
        removed = 0
        for folder in self.root.iterdir():
            if not folder.is_dir() or not TOKEN.match(folder.name):
                continue
            try:
                if folder.stat().st_mtime < cutoff:
                    shutil.rmtree(folder, ignore_errors=True)
                    removed += 1
            except OSError:
                continue
        return removed

    def free_bytes(self) -> int:
        self.root.mkdir(parents=True, exist_ok=True)
        return shutil.disk_usage(self.root).free


def estimated_size(info: dict[str, Any]) -> int | None:
    """Sum of the selected formats' sizes, exact or approximate, when YouTube reports them."""
    formats = info.get("requested_formats") or [info]
    sizes = [item.get("filesize") or item.get("filesize_approx") for item in formats]
    return int(sum(sizes)) if sizes and all(isinstance(size, (int, float)) and size > 0 for size in sizes) else None


def format_selector(max_height: int | None) -> str:
    """Best video plus best audio (merged), or the best single file when that is all there is."""
    if max_height:
        return f"bv*[height<={max_height}]+ba/b[height<={max_height}]/bv*+ba/b"
    return "bv*+ba/b"
