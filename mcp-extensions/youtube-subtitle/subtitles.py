"""Finding, downloading and cleaning YouTube subtitles with yt-dlp.

Everything except `fetch_info` and `download_track` is pure so it can be tested without a network.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html import unescape
from typing import Any
from urllib.parse import parse_qs, urlparse

YOUTUBE_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
    "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
}
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
# Paths that carry the video id as their second segment: /shorts/<id>, /live/<id>, /embed/<id>, /v/<id>.
ID_PATH_PREFIXES = {"shorts", "live", "embed", "v"}
# Preferred download formats, cleanest first.
FORMAT_ORDER = ["json3", "vtt", "srv3", "srv1"]


class SubtitleError(Exception):
    """A problem worth showing to the model as it is."""


def video_url(value: str) -> tuple[str, str]:
    """A canonical watch URL and the video id. Only YouTube links (or a bare 11-character id) are accepted, so
    yt-dlp's generic extractor can never be pointed at another host."""
    text = (value or "").strip()
    if VIDEO_ID.match(text):
        return f"https://www.youtube.com/watch?v={text}", text
    parsed = urlparse(text if "://" in text else f"https://{text}")
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or host not in YOUTUBE_HOSTS:
        raise SubtitleError("Only YouTube video links (youtube.com, youtu.be) or an 11-character video id are supported.")
    segments = [part for part in parsed.path.split("/") if part]
    if host == "youtu.be":
        candidate = segments[0] if segments else ""
    elif segments[:1] == ["watch"] or not segments:
        candidate = (parse_qs(parsed.query).get("v") or [""])[0]
    elif segments[0] in ID_PATH_PREFIXES and len(segments) > 1:
        candidate = segments[1]
    else:
        candidate = ""
    if not VIDEO_ID.match(candidate):
        raise SubtitleError("The link does not point to a single YouTube video. Playlists and channels are not supported.")
    return f"https://www.youtube.com/watch?v={candidate}", candidate


@dataclass(frozen=True)
class Track:
    language: str
    kind: str  # "manual" or "auto"
    translated: bool
    formats: list[dict[str, Any]]


def _base(code: str) -> str:
    return code.lower().removesuffix("-orig").split("-")[0]


def _find(tracks: dict[str, list[dict[str, Any]]], wanted: str) -> str | None:
    """Exact key first, then the same base language (en matches en-US, en-GB)."""
    wanted = wanted.lower()
    for key in tracks:
        if key.lower() == wanted:
            return key
    for key in tracks:
        if _base(key) == _base(wanted) and not key.lower().endswith("-orig") and key != "live_chat":
            return key
    return None


def choose_track(info: dict[str, Any], requested: str = "", preferred: list[str] | None = None) -> Track:
    """Pick the most faithful track: uploaded subtitles, then YouTube's captions in the spoken language, and only then
    a machine translation of them."""
    manual = {key: value for key, value in (info.get("subtitles") or {}).items() if key != "live_chat" and value}
    auto = {key: value for key, value in (info.get("automatic_captions") or {}).items() if value}
    spoken = (info.get("language") or "").lower()
    # Automatic captions in a spoken language are keyed "<lang>-orig"; YouTube may mark more than one.
    originals = [key for key in auto if key.lower().endswith("-orig")]
    original_for = lambda code: next((key for key in originals if _base(key) == _base(code)), None)
    spoken_auto = original_for(spoken) if spoken else (originals[0] if originals else None)
    if not spoken and spoken_auto:
        spoken = _base(spoken_auto)

    def manual_track(code: str) -> Track | None:
        key = _find(manual, code) if code else None
        return Track(key, "manual", False, manual[key]) if key else None

    def auto_track(code: str) -> Track | None:
        if not code:
            return None
        original = original_for(code)
        if original:
            return Track(original.removesuffix("-orig"), "auto", False, auto[original])
        key = _find(auto, code)
        return Track(key, "auto", _base(key) != _base(spoken) if spoken else True, auto[key]) if key else None

    if requested:
        found = manual_track(requested) or auto_track(requested)
        if not found:
            raise SubtitleError(f"No subtitles in '{requested}'. Use list_youtube_subtitles to see the available languages.")
        return found
    for code in [spoken, *(preferred or [])]:
        found = manual_track(code)
        if found:
            return found
    if manual:
        key = next(iter(manual))
        return Track(key, "manual", False, manual[key])
    found = auto_track(spoken) or (Track(spoken_auto.removesuffix("-orig"), "auto", False, auto[spoken_auto]) if spoken_auto else None)
    if found:
        return found
    for code in preferred or []:
        found = auto_track(code)
        if found:
            return found
    raise SubtitleError("This video has no subtitles or automatic captions.")


def pick_format(track: Track) -> dict[str, Any]:
    by_ext = {item.get("ext"): item for item in track.formats if item.get("url")}
    for ext in FORMAT_ORDER:
        if ext in by_ext:
            return by_ext[ext]
    raise SubtitleError("The subtitles are only offered in formats this tool cannot read.")


_TAG = re.compile(r"<[^>]+>")


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", unescape(_TAG.sub("", text))).strip()


def parse_json3(raw: str) -> list[tuple[int, str]]:
    cues: list[tuple[int, str]] = []
    for event in json.loads(raw).get("events") or []:
        segments = event.get("segs")
        if not segments:
            continue
        text = _clean("".join(segment.get("utf8", "") for segment in segments))
        if text:
            cues.append((int(event.get("tStartMs") or 0), text))
    return cues


_TIMING = re.compile(r"^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})\s+-->")


def parse_vtt(raw: str) -> list[tuple[int, str]]:
    """WebVTT cues. Rolling automatic captions repeat the previous line in every cue; repeats are dropped."""
    cues: list[tuple[int, str]] = []
    recent: list[str] = []
    for block in re.split(r"\r?\n\r?\n", raw):
        lines = block.strip().splitlines()
        timing = next((index for index, line in enumerate(lines) if _TIMING.match(line)), None)
        if timing is None:
            continue
        hours, minutes, seconds, millis = _TIMING.match(lines[timing]).groups()
        start = ((int(hours or 0) * 60 + int(minutes)) * 60 + int(seconds)) * 1000 + int(millis)
        for line in lines[timing + 1:]:
            text = _clean(line)
            if text and text not in recent:
                cues.append((start, text))
                recent = (recent + [text])[-3:]
    return cues


def parse_srv(raw: str) -> list[tuple[int, str]]:
    """YouTube's XML timed text (srv1 uses seconds in `start`, srv3 milliseconds in `t`)."""
    cues: list[tuple[int, str]] = []
    for match in re.finditer(r"<(?:text|p)\b([^>]*)>(.*?)</(?:text|p)>", raw, re.S):
        attributes, body = match.groups()
        start_ms = re.search(r'\bt="(\d+)"', attributes)
        start_s = re.search(r'\bstart="([\d.]+)"', attributes)
        start = int(start_ms.group(1)) if start_ms else int(float(start_s.group(1)) * 1000) if start_s else 0
        text = _clean(body)
        if text:
            cues.append((start, text))
    return cues


def parse_subtitles(raw: str, ext: str) -> list[tuple[int, str]]:
    cues = parse_json3(raw) if ext == "json3" else parse_vtt(raw) if ext == "vtt" else parse_srv(raw)
    deduplicated: list[tuple[int, str]] = []
    for start, text in cues:
        if not deduplicated or deduplicated[-1][1] != text:
            deduplicated.append((start, text))
    return deduplicated


def clock(milliseconds: int) -> str:
    seconds = max(0, milliseconds // 1000)
    hours, rest = divmod(seconds, 3600)
    minutes, seconds = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"


def transcript_text(cues: list[tuple[int, str]], timestamps: bool = False) -> str:
    """Plain text in paragraphs (a new one after a pause of 2.5 s or about 600 characters). With timestamps, each
    paragraph starts with its time, e.g. [3:05]."""
    paragraphs: list[tuple[int, list[str]]] = []
    previous_start = None
    for start, text in cues:
        current = paragraphs[-1] if paragraphs else None
        long = current is not None and sum(len(part) + 1 for part in current[1]) > 600
        pause = previous_start is not None and start - previous_start > 2500
        if current is None or long or pause:
            paragraphs.append((start, [text]))
        else:
            current[1].append(text)
        previous_start = start
    return "\n\n".join((f"[{clock(start)}] " if timestamps else "") + " ".join(parts) for start, parts in paragraphs)


def page(text: str, offset: int, limit: int) -> tuple[str, int | None]:
    """One window of the transcript. The cut moves back to the last whitespace so words are not split."""
    offset = max(0, min(offset, len(text)))
    end = offset + max(1, limit)
    if end >= len(text):
        return text[offset:], None
    space = text.rfind(" ", offset + limit // 2, end)
    end = space if space > offset else end
    return text[offset:end], end


def languages_summary(info: dict[str, Any]) -> dict[str, Any]:
    """Uploaded subtitle languages, the spoken language of automatic captions, and how many machine translations exist."""
    manual = sorted(key for key in (info.get("subtitles") or {}) if key != "live_chat")
    auto = info.get("automatic_captions") or {}
    spoken = sorted(key.removesuffix("-orig") for key in auto if key.lower().endswith("-orig"))
    return {"manual": manual, "auto_spoken": spoken, "auto_translated": max(0, len(auto) - len(spoken))}
