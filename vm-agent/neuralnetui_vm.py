#!/usr/bin/env python3
"""
NeuralNetUI virtual computer server.

One file, Python 3.9+ standard library only. It turns a Linux machine (LXC, Docker, bare metal) or a Mac into a
"virtual computer" a NeuralNetUI model can use:

  POST /mcp                     MCP (Streamable HTTP): computer info, shell, background jobs, screen and input
  POST /browser/<session>       MCP proxy to an Obscura headless browser, one process per session
  GET  /browser-download        a file fetched by Obscura with the account's cookies
  GET|PUT /browser-cookies      the account browser's cookies as cookies.txt (Netscape format); kept only here
  GET|PUT /files?path=...       file transfer with the caller's workspace

Every request needs "Authorization: Bearer <key>". NeuralNetUI also sends "X-NNUI-User", an opaque id: each id
gets its own workspace (its own Linux account and home folder when the server runs as root on Linux, otherwise a
folder), so several NeuralNetUI accounts can share one computer without seeing each other's files.

Configuration (environment variables override the JSON config file given with --config):
  NNUI_VM_KEY       access key (required)
  NNUI_VM_BIND      address to listen on (default 127.0.0.1)
  NNUI_VM_PORT      port (default 8765)
  NNUI_VM_HOME      data folder (workspaces, browser profiles)
  NNUI_VM_OBSCURA   path to the obscura binary (default: next to this file in bin/, else on PATH)
  NNUI_VM_ACCOUNTS  0 keeps workspaces as folders instead of separate Linux accounts
  DISPLAY           X display for screen and input tools on Linux (no display means no GUI tools)
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import platform
import queue
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

VERSION = "1.1.0"
PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
MAX_OUTPUT = 100_000
SYSTEM = platform.system()  # "Linux" or "Darwin"
IS_ROOT = hasattr(os, "geteuid") and os.geteuid() == 0


def log(*parts):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *parts, file=sys.stderr, flush=True)


# ------------------------------------------------------------------------------------------------ configuration

class Config:
    def __init__(self, path=None):
        data = {}
        if path and os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        self.key = os.environ.get("NNUI_VM_KEY") or data.get("key") or ""
        self.bind = os.environ.get("NNUI_VM_BIND") or data.get("bind") or "127.0.0.1"
        self.port = int(os.environ.get("NNUI_VM_PORT") or data.get("port") or 8765)
        default_home = "/var/lib/neuralnetui-vm" if IS_ROOT and SYSTEM == "Linux" else os.path.expanduser("~/.neuralnetui-vm")
        self.home = os.environ.get("NNUI_VM_HOME") or data.get("home") or default_home
        here = os.path.dirname(os.path.abspath(__file__))
        candidates = [os.environ.get("NNUI_VM_OBSCURA"), data.get("obscura"), os.path.join(here, "bin", "obscura"), shutil.which("obscura")]
        self.obscura = next((c for c in candidates if c and os.path.isfile(c) and os.access(c, os.X_OK)), None)
        # Obscura renders pages itself; stealth is on unless turned off.
        self.stealth = str(os.environ.get("NNUI_VM_STEALTH", data.get("stealth", "1"))).lower() not in ("0", "false", "no")
        self.idle_minutes = int(os.environ.get("NNUI_VM_BROWSER_IDLE_MINUTES") or data.get("browserIdleMinutes") or 10)


CONFIG = None


# ------------------------------------------------------------------------------------------------ workspaces

USER_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def system_tool(name):
    """A system binary even when /usr/sbin is not on PATH (services often run with a short PATH)."""
    return shutil.which(name) or next((p for p in (f"/usr/sbin/{name}", f"/sbin/{name}", f"/usr/bin/{name}", f"/bin/{name}") if os.path.exists(p)), None)
_workspace_lock = threading.Lock()


class Workspace:
    """Where one caller's commands run and files live."""

    def __init__(self, caller):
        if not USER_ID.match(caller or ""):
            raise PermissionError("Missing or invalid X-NNUI-User header.")
        digest = hashlib.sha256(caller.encode()).hexdigest()[:12]
        self.caller = caller
        self.account = None
        useradd, runuser = system_tool("useradd"), system_tool("runuser")
        # NNUI_VM_ACCOUNTS=0 keeps workspaces as folders even as root (e.g. when testing on a shared machine).
        if IS_ROOT and SYSTEM == "Linux" and useradd and runuser and os.environ.get("NNUI_VM_ACCOUNTS", "1") != "0":
            account = f"nnui-{digest}"
            with _workspace_lock:
                exists = subprocess.run([system_tool("id") or "id", "-u", account], capture_output=True).returncode == 0
                if not exists:
                    created = subprocess.run([useradd, "-m", "-s", "/bin/bash", "-c", "NeuralNetUI workspace", account], capture_output=True, text=True)
                    exists = created.returncode == 0
                    if not exists: log("could not create workspace account:", created.stderr.strip())
            if exists:
                self.account, self.runuser = account, runuser
                self.home = os.path.expanduser(f"~{account}")
        if not self.account:
            self.home = os.path.join(CONFIG.home, "workspaces", digest)
            os.makedirs(self.home, mode=0o700, exist_ok=True)
        self.state = os.path.join(CONFIG.home, "state", digest)
        os.makedirs(self.state, mode=0o700, exist_ok=True)

    def command(self, script):
        """The argv that runs a shell script as this workspace."""
        if self.account:
            return [self.runuser, "-u", self.account, "--", "bash", "-lc", script]
        shell = "/bin/zsh" if SYSTEM == "Darwin" and os.path.exists("/bin/zsh") else "/bin/bash"
        return [shell, "-lc", script]

    def env(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith("NNUI_VM_")}
        env["HOME"] = self.home
        if self.account:
            env["USER"] = env["LOGNAME"] = self.account
        return env

    def resolve(self, path):
        """A path inside the workspace (relative paths start at its home)."""
        target = os.path.realpath(os.path.join(self.home, os.path.expanduser(path)) if not os.path.isabs(path) else path)
        home = os.path.realpath(self.home)
        if target != home and not target.startswith(home + os.sep):
            raise PermissionError(f"Paths must stay inside the workspace ({self.home}).")
        return target

    def own(self, path):
        if self.account:
            shutil.chown(path, user=self.account, group=self.account)


_workspaces = {}


def workspace_for(caller):
    with _workspace_lock:
        found = _workspaces.get(caller)
    if found:
        return found
    created = Workspace(caller)
    with _workspace_lock:
        _workspaces[caller] = created
    return created


# ------------------------------------------------------------------------------------------------ GUI

def gui_status():
    if SYSTEM == "Darwin":
        ok = bool(shutil.which("screencapture"))
        return {"available": ok, "kind": "macos", "control": bool(shutil.which("cliclick")), "reason": None if ok else "screencapture is missing"}
    if not os.environ.get("DISPLAY"):
        return {"available": False, "kind": None, "control": False, "reason": "No X display (headless)."}
    capture = bool(shutil.which("import") or shutil.which("magick"))
    control = bool(shutil.which("xdotool"))
    if not capture:
        return {"available": False, "kind": "x11", "control": control, "reason": "ImageMagick (import) is not installed."}
    return {"available": True, "kind": "x11", "control": control, "reason": None if control else "xdotool is not installed; screenshots only."}


_scale = {"factor": 1.0}


def screenshot(max_width=1600):
    with tempfile.TemporaryDirectory() as folder:
        raw = os.path.join(folder, "screen.png")
        if SYSTEM == "Darwin":
            subprocess.run(["screencapture", "-x", "-t", "png", raw], check=True, timeout=30)
        else:
            tool = ["import"] if shutil.which("import") else ["magick", "import"]
            subprocess.run(tool + ["-silent", "-window", "root", raw], check=True, timeout=30, capture_output=True)
        size = image_size(raw)
        factor = 1.0
        if size and size[0] > max_width:
            factor = size[0] / max_width
            resized = os.path.join(folder, "small.png")
            resize = shutil.which("magick") and ["magick", raw, "-resize", f"{max_width}x", resized] or (shutil.which("convert") and ["convert", raw, "-resize", f"{max_width}x", resized])
            if SYSTEM == "Darwin":
                resize = ["sips", "--resampleWidth", str(max_width), raw, "--out", resized]
            if resize and subprocess.run(resize, capture_output=True, timeout=30).returncode == 0:
                raw = resized
            else:
                factor = 1.0
        _scale["factor"] = factor
        with open(raw, "rb") as handle:
            data = handle.read()
        shown = image_size(raw) or size
        return data, size, shown, factor


def image_size(path):
    with open(path, "rb") as handle:
        head = handle.read(24)
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
    return None


def to_screen(value):
    return int(round(float(value) * _scale["factor"]))


def run_input(argv):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or f"{argv[0]} failed").strip())


MAC_KEYS = {"enter": "return", "return": "return", "esc": "esc", "escape": "esc", "tab": "tab", "space": "space", "backspace": "delete", "delete": "fwd-delete",
            "up": "arrow-up", "down": "arrow-down", "left": "arrow-left", "right": "arrow-right", "home": "home", "end": "end", "pageup": "page-up", "pagedown": "page-down"}
MAC_MODIFIERS = {"cmd": "cmd", "command": "cmd", "super": "cmd", "ctrl": "ctrl", "control": "ctrl", "alt": "alt", "option": "alt", "shift": "shift", "fn": "fn"}


def mouse(action, x=None, y=None, to_x=None, to_y=None, button="left", amount=3):
    if SYSTEM == "Darwin":
        if not shutil.which("cliclick"):
            raise RuntimeError("cliclick is not installed (brew install cliclick).")
        point = f"{to_screen(x)},{to_screen(y)}" if x is not None else None
        if action == "move": run_input(["cliclick", f"m:{point}"])
        elif action == "click": run_input(["cliclick", f"{'rc' if button == 'right' else 'c'}:{point}"])
        elif action == "double_click": run_input(["cliclick", f"dc:{point}"])
        elif action == "right_click": run_input(["cliclick", f"rc:{point}"])
        elif action == "drag": run_input(["cliclick", f"dd:{point}", f"du:{to_screen(to_x)},{to_screen(to_y)}"])
        else: raise RuntimeError(f"{action} is not supported on macOS.")
        return
    base = ["xdotool"]
    if x is not None and action != "scroll":
        run_input(base + ["mousemove", str(to_screen(x)), str(to_screen(y))])
    number = {"left": "1", "middle": "2", "right": "3"}.get(button, "1")
    if action == "move": return
    if action == "click": run_input(base + ["click", number])
    elif action == "double_click": run_input(base + ["click", "--repeat", "2", number])
    elif action == "right_click": run_input(base + ["click", "3"])
    elif action == "drag":
        run_input(base + ["mousedown", number]); run_input(base + ["mousemove", str(to_screen(to_x)), str(to_screen(to_y))]); run_input(base + ["mouseup", number])
    elif action == "scroll":
        if x is not None: run_input(base + ["mousemove", str(to_screen(x)), str(to_screen(y))])
        steps = int(amount or 3)
        run_input(base + ["click", "--repeat", str(abs(steps)), "5" if steps > 0 else "4"])
    else:
        raise RuntimeError(f"Unknown mouse action {action}.")


def keyboard(text=None, keys=None):
    if SYSTEM == "Darwin":
        if not shutil.which("cliclick"):
            raise RuntimeError("cliclick is not installed (brew install cliclick).")
        if text: run_input(["cliclick", f"t:{text}"])
        if keys:
            for combo in keys.split():
                parts = [p.lower() for p in combo.split("+")]
                mods = [MAC_MODIFIERS[p] for p in parts[:-1] if p in MAC_MODIFIERS]
                key = parts[-1]
                argv = ["cliclick"] + [f"kd:{','.join(mods)}"] * bool(mods)
                argv.append(f"kp:{MAC_KEYS[key]}" if key in MAC_KEYS else f"t:{key}")
                if mods: argv.append(f"ku:{','.join(mods)}")
                run_input(argv)
        return
    if text: run_input(["xdotool", "type", "--delay", "12", "--", text])
    if keys: run_input(["xdotool", "key", "--"] + keys.split())


# ------------------------------------------------------------------------------------------------ shell

def clip(text):
    return text if len(text) <= MAX_OUTPUT else text[:MAX_OUTPUT // 2] + f"\n[... {len(text) - MAX_OUTPUT} characters cut ...]\n" + text[-MAX_OUTPUT // 2:]


def shell_run(ws, command, cwd=None, timeout=120, progress=None):
    directory = ws.resolve(cwd) if cwd else ws.home
    proc = subprocess.Popen(ws.command(command), cwd=directory, env=ws.env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    out, err = [], []
    readers = [threading.Thread(target=lambda s, b: b.append(s.read()), args=(proc.stdout, out), daemon=True),
               threading.Thread(target=lambda s, b: b.append(s.read()), args=(proc.stderr, err), daemon=True)]
    for reader in readers: reader.start()
    started = time.time(); timed_out = False
    while proc.poll() is None:
        if time.time() - started > timeout:
            timed_out = True
            os.killpg(proc.pid, signal.SIGKILL)
            break
        if progress: progress(time.time() - started, f"Running for {int(time.time() - started)} s")
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: pass
    proc.wait()
    for reader in readers: reader.join(timeout=5)
    decode = lambda chunks: clip(b"".join(chunks).decode("utf-8", "replace"))
    return {"exit_code": None if timed_out else proc.returncode, "timed_out": timed_out, "seconds": round(time.time() - started, 1), "stdout": decode(out), "stderr": decode(err), "cwd": directory}


class Jobs:
    def __init__(self):
        self.lock = threading.Lock()
        self.items = {}

    def start(self, ws, command, cwd=None):
        directory = ws.resolve(cwd) if cwd else ws.home
        job = uuid.uuid4().hex[:12]
        log_path = os.path.join(ws.state, f"job-{job}.log")
        handle = open(log_path, "wb")
        proc = subprocess.Popen(ws.command(command), cwd=directory, env=ws.env(), stdout=handle, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
        with self.lock:
            self.items[job] = {"id": job, "caller": ws.caller, "command": command, "cwd": directory, "proc": proc, "log": log_path, "handle": handle, "started": time.time()}
        return self.describe(self.items[job])

    def describe(self, item):
        code = item["proc"].poll()
        return {"job_id": item["id"], "command": item["command"], "cwd": item["cwd"], "running": code is None, "exit_code": code, "seconds": round(time.time() - item["started"], 1)}

    def get(self, ws, job):
        with self.lock:
            item = self.items.get(job)
        if not item or item["caller"] != ws.caller:
            raise KeyError(f"No job {job}.")
        return item

    def output(self, ws, job, offset=0, limit=MAX_OUTPUT):
        item = self.get(ws, job)
        with open(item["log"], "rb") as handle:
            handle.seek(max(0, int(offset)))
            chunk = handle.read(limit)
            end = handle.tell()
        size = os.path.getsize(item["log"])
        return {**self.describe(item), "output": chunk.decode("utf-8", "replace"), "next_offset": end, "more": end < size}

    def kill(self, ws, job):
        item = self.get(ws, job)
        if item["proc"].poll() is None:
            try: os.killpg(item["proc"].pid, signal.SIGTERM)
            except ProcessLookupError: pass
            try: item["proc"].wait(timeout=5)
            except subprocess.TimeoutExpired: os.killpg(item["proc"].pid, signal.SIGKILL)
        return self.describe(item)

    def list(self, ws):
        with self.lock:
            return [self.describe(item) for item in self.items.values() if item["caller"] == ws.caller]


JOBS = Jobs()


# ------------------------------------------------------------------------------------------------ MCP tools

def text(value):
    return {"content": [{"type": "text", "text": value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)}]}


def obscura_version():
    if not CONFIG.obscura: return None
    try: return subprocess.run([CONFIG.obscura, "--version"], capture_output=True, text=True, timeout=10).stdout.strip() or "installed"
    except Exception: return "installed"


def computer_info(ws):
    gui = gui_status()
    distro = None
    if SYSTEM == "Linux" and os.path.exists("/etc/os-release"):
        with open("/etc/os-release", encoding="utf-8") as handle:
            fields = dict(line.rstrip("\n").split("=", 1) for line in handle if "=" in line)
        distro = fields.get("PRETTY_NAME", "").strip('"')
    elif SYSTEM == "Darwin":
        distro = f"macOS {platform.mac_ver()[0]}"
    kind = "docker" if os.path.exists("/.dockerenv") else "lxc" if os.environ.get("container") == "lxc" or os.path.exists("/run/host/container-manager") else "machine"
    return {"server_version": VERSION, "os": SYSTEM, "distribution": distro, "kernel": platform.release(), "architecture": platform.machine(), "hostname": platform.node(),
            "environment": kind, "gui": gui, "browser": {"engine": "obscura", "version": obscura_version(), "stealth": CONFIG.stealth},
            "workspace": {"home": ws.home, "account": ws.account}, "python": platform.python_version(), "cpus": os.cpu_count()}


TOOLS = {
    "computer_info": {"description": "Describe the virtual computer: operating system, distribution, architecture, whether it has a screen (GUI) and input control, the browser, and your workspace folder. Call it first.",
                      "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}, "annotations": {"readOnlyHint": True}},
    "shell_run": {"description": "Run a shell script (bash; zsh on macOS) in your workspace and wait for it. Returns exit code, stdout and stderr. Use for commands that finish within the timeout; start long work with shell_start.",
                  "inputSchema": {"type": "object", "additionalProperties": False, "required": ["command"], "properties": {
                      "command": {"type": "string", "description": "The complete script; multiple lines, pipes and && are fine."},
                      "cwd": {"type": "string", "description": "Folder inside the workspace (default: home)."},
                      "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 3600, "description": "Default 120."}}},
                  "annotations": {"destructiveHint": True}},
    "shell_start": {"description": "Start a long-running script in the background (builds, downloads, servers) and return a job id at once. Read its output with shell_output and stop it with shell_kill.",
                    "inputSchema": {"type": "object", "additionalProperties": False, "required": ["command"], "properties": {"command": {"type": "string"}, "cwd": {"type": "string"}}},
                    "annotations": {"destructiveHint": True}},
    "shell_output": {"description": "Read a background job's combined output from an offset (use next_offset from the previous call) and whether it is still running.",
                     "inputSchema": {"type": "object", "additionalProperties": False, "required": ["job_id"], "properties": {"job_id": {"type": "string"}, "offset": {"type": "integer", "minimum": 0}}},
                     "annotations": {"readOnlyHint": True}},
    "shell_jobs": {"description": "List your background jobs.", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}, "annotations": {"readOnlyHint": True}},
    "shell_kill": {"description": "Stop a background job.", "inputSchema": {"type": "object", "additionalProperties": False, "required": ["job_id"], "properties": {"job_id": {"type": "string"}}},
                   "annotations": {"destructiveHint": True}},
}

GUI_TOOLS = {
    "screen_capture": {"description": "Take a screenshot of the computer's screen. Coordinates for mouse actions are in this image's pixels.",
                       "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}, "annotations": {"readOnlyHint": True}},
    "mouse": {"description": "Move, click, double-click, right-click, drag or scroll at screen coordinates taken from the latest screen_capture.",
              "inputSchema": {"type": "object", "additionalProperties": False, "required": ["action"], "properties": {
                  "action": {"type": "string", "enum": ["move", "click", "double_click", "right_click", "drag", "scroll"]},
                  "x": {"type": "number"}, "y": {"type": "number"}, "to_x": {"type": "number"}, "to_y": {"type": "number"},
                  "button": {"type": "string", "enum": ["left", "middle", "right"]}, "amount": {"type": "integer", "description": "Scroll steps; positive scrolls down."}}},
              "annotations": {"destructiveHint": True}},
    "keyboard": {"description": "Type text, and/or press keys or shortcuts separated by spaces (e.g. \"ctrl+l Return\"; on macOS \"cmd+c\").",
                 "inputSchema": {"type": "object", "additionalProperties": False, "properties": {"text": {"type": "string"}, "keys": {"type": "string"}}},
                 "annotations": {"destructiveHint": True}},
}


def available_tools():
    tools = dict(TOOLS)
    gui = gui_status()
    if gui["available"]:
        tools["screen_capture"] = GUI_TOOLS["screen_capture"]
        if gui["control"]:
            tools["mouse"] = GUI_TOOLS["mouse"]; tools["keyboard"] = GUI_TOOLS["keyboard"]
    return [{"name": name, **spec} for name, spec in tools.items()]


def call_tool(ws, name, args, progress):
    if name not in {tool["name"] for tool in available_tools()}:
        raise ValueError(f"Unknown or unavailable tool {name}.")
    if name == "computer_info": return text(computer_info(ws))
    if name == "shell_run":
        result = shell_run(ws, str(args.get("command") or ""), args.get("cwd"), min(3600, max(1, int(args.get("timeout_seconds") or 120))), progress)
        return {**text(result), "isError": result["exit_code"] != 0}
    if name == "shell_start": return text(JOBS.start(ws, str(args.get("command") or ""), args.get("cwd")))
    if name == "shell_output": return text(JOBS.output(ws, str(args.get("job_id") or ""), int(args.get("offset") or 0)))
    if name == "shell_jobs": return text(JOBS.list(ws))
    if name == "shell_kill": return text(JOBS.kill(ws, str(args.get("job_id") or "")))
    if name == "screen_capture":
        data, size, shown, factor = screenshot()
        note = f"Screen {size[0]}x{size[1]}" + (f", shown at {shown[0]}x{shown[1]} (use these image coordinates)" if factor != 1.0 else "") if size else "Screenshot"
        return {"content": [{"type": "image", "data": base64.b64encode(data).decode(), "mimeType": "image/png"}, {"type": "text", "text": note}]}
    if name == "mouse":
        mouse(str(args.get("action")), args.get("x"), args.get("y"), args.get("to_x"), args.get("to_y"), str(args.get("button") or "left"), args.get("amount"))
        return text("Done.")
    if name == "keyboard":
        if not args.get("text") and not args.get("keys"): raise ValueError("Give text or keys.")
        keyboard(args.get("text"), args.get("keys"))
        return text("Done.")
    raise ValueError(f"Unknown tool {name}.")


# ------------------------------------------------------------------------------------------------ Obscura browser sessions

# The account's browser profile is shared by all its conversations: one cookie jar in
# ~/.neuralnetui/browser/account/cookies.json, kept here on the virtual computer only (NeuralNetUI reads and
# writes it through /browser-cookies but keeps no copy). Each browser session works in its own folder under
# browser/sessions/: it starts with a copy of the account profile, and when it closes, the cookies it added,
# changed or removed are merged back into the account jar (a three-way merge against the copy it started with, so
# sessions running side by side, or an edit made meanwhile, are not overwritten), then the folder is deleted.

def _safe(name):
    return re.sub(r"[^A-Za-z0-9_-]", "_", name)[:80] or "_"


def browser_root(ws):
    return os.path.join(ws.home, ".neuralnetui", "browser")


def account_profile(ws):
    return os.path.join(browser_root(ws), "account")


def session_profile(ws, key):
    return os.path.join(browser_root(ws), "sessions", _safe(key))


_jar_locks = {}
_jar_locks_lock = threading.Lock()


def jar_lock(ws):
    with _jar_locks_lock:
        return _jar_locks.setdefault(ws.home, threading.Lock())


def _own_tree(ws, path):
    if not ws.account: return
    stop = os.path.dirname(ws.home)
    current = path
    while current.startswith(ws.home) and current != stop:
        ws.own(current); current = os.path.dirname(current)


def read_cookies(folder):
    try:
        with open(os.path.join(folder, "cookies.json"), encoding="utf-8") as handle: data = json.load(handle)
        return [c for c in data if isinstance(c, dict) and c.get("name")] if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def write_cookies(ws, folder, cookies):
    os.makedirs(folder, exist_ok=True)
    target = os.path.join(folder, "cookies.json")
    temp = target + ".tmp"
    with open(temp, "w", encoding="utf-8") as handle: json.dump(cookies, handle, ensure_ascii=False)
    os.replace(temp, target)
    for path in (folder, target): _own_tree(ws, path)


def cookie_key(cookie):
    return (str(cookie.get("domain") or "").lstrip(".").lower(), cookie.get("path") or "/", cookie.get("name"))


def merge_cookies(account, seed, final):
    """The account jar after a session that started from `seed` ended with `final`: what the session added or changed
    wins, what it removed goes (unless the account changed it meanwhile), everything else stays as the account has it."""
    merged = {cookie_key(c): c for c in account}
    before = {cookie_key(c): c for c in seed}
    after = {cookie_key(c): c for c in final}
    for key, cookie in after.items():
        if before.get(key) != cookie: merged[key] = cookie
    for key, cookie in before.items():
        if key not in after and merged.get(key) == cookie: merged.pop(key, None)
    return list(merged.values())


def cookies_to_netscape(cookies):
    lines = ["# Netscape HTTP Cookie File", "# Cookies of this account's browser on the NeuralNetUI virtual computer.", ""]
    for c in sorted(cookies, key=lambda c: (cookie_key(c)[0], cookie_key(c)[1], str(c.get("name")))):
        domain = str(c.get("domain") or "").lstrip(".")
        sub = not c.get("hostOnly", False)
        expires = c.get("expires")
        lines.append("\t".join([("#HttpOnly_" if c.get("httpOnly") else "") + ("." if sub else "") + domain, "TRUE" if sub else "FALSE",
                                c.get("path") or "/", "TRUE" if c.get("secure") else "FALSE",
                                str(int(expires)) if isinstance(expires, (int, float)) and expires > 0 else "0", str(c.get("name")), str(c.get("value") or "")]))
    return "\n".join(lines) + "\n"


def netscape_to_cookies(text, previous=()):
    """Cookies from a cookies.txt (Netscape format, as browser extensions export it). SameSite is not part of the
    format: a cookie that already existed keeps its setting, a new one gets Lax."""
    known = {cookie_key(c): c for c in previous}
    cookies, problems = {}, []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip("\r\n")
        http_only = line.startswith("#HttpOnly_")
        if http_only: line = line[len("#HttpOnly_"):]
        elif not line.strip() or line.lstrip().startswith("#"): continue
        fields = line.split("\t")
        if len(fields) < 7: fields = line.split(None, 6)
        if len(fields) < 6:
            problems.append(f"line {number}: expected 7 tab-separated fields"); continue
        if len(fields) == 6: fields.append("")
        domain, include, path, secure, expires, name, value = fields[:7]
        if not domain or not name:
            problems.append(f"line {number}: missing domain or name"); continue
        try: expiry = int(float(expires))
        except ValueError:
            problems.append(f"line {number}: expiry is not a number"); continue
        cookie = {"name": name, "value": value, "domain": domain.lstrip(".").lower(), "path": path or "/",
                  "secure": secure.upper() == "TRUE", "httpOnly": http_only,
                  "sameSite": "Lax", "expires": expiry if expiry > 0 else None,
                  "hostOnly": not (domain.startswith(".") or include.upper() == "TRUE")}
        cookie["sameSite"] = (known.get(cookie_key(cookie)) or {}).get("sameSite") or "Lax"
        cookies[cookie_key(cookie)] = cookie
    return list(cookies.values()), problems


class BrowserSession:
    """One `obscura mcp` process speaking MCP over stdio, in its own working copy of the account profile."""

    def __init__(self, ws, key):
        if not CONFIG.obscura:
            raise RuntimeError("Obscura is not installed on this computer.")
        self.ws, self.key = ws, key
        self.profile = session_profile(ws, key)
        if os.path.isdir(self.profile): shutil.rmtree(self.profile, ignore_errors=True)
        with jar_lock(ws):
            source = account_profile(ws)
            if os.path.isdir(source): shutil.copytree(source, self.profile)
            else: os.makedirs(self.profile)
            self.seed = read_cookies(self.profile)
        for root, dirs, files in os.walk(self.profile):
            for name in dirs + files: _own_tree(ws, os.path.join(root, name))
        _own_tree(ws, self.profile)
        argv = [CONFIG.obscura] + (["--stealth"] if CONFIG.stealth else []) + ["mcp"]
        if ws.account: argv = [ws.runuser, "-u", ws.account, "--", "env", f"OBSCURA_STORAGE_DIR={self.profile}", "RUST_LOG=error"] + argv
        env = {**ws.env(), "OBSCURA_STORAGE_DIR": self.profile, "RUST_LOG": "error"}
        self.proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, cwd=ws.home, start_new_session=True)
        self.lock = threading.Lock()
        self.pending = {}
        self.last = time.time()
        self.closed = False
        threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        for line in self.proc.stdout:
            try: message = json.loads(line)
            except ValueError: continue
            waiter = self.pending.pop(message.get("id"), None) if "id" in message else None
            if waiter: waiter.put(message)
        for waiter in list(self.pending.values()): waiter.put({"jsonrpc": "2.0", "error": {"code": -32000, "message": "The browser process exited."}})

    def alive(self):
        return self.proc.poll() is None

    def send(self, message, timeout=120):
        self.last = time.time()
        waiter = None
        if "id" in message and "method" in message:
            waiter = queue.Queue(); self.pending[message["id"]] = waiter
        with self.lock:
            self.proc.stdin.write((json.dumps(message) + "\n").encode()); self.proc.stdin.flush()
        if not waiter: return None
        try: return waiter.get(timeout=timeout)
        except queue.Empty:
            self.pending.pop(message["id"], None)
            return {"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32001, "message": "The browser did not answer in time."}}

    def close(self, keep=True):
        """Ends the browser: closing stdin lets Obscura write its cookies before it exits (a stuck one is killed after
        a few seconds and reaped). With keep, the session's cookie changes are merged into the account jar; then the
        working folder is deleted."""
        if self.closed: return
        self.closed = True
        try: self.proc.stdin.close()
        except Exception: pass
        try: self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try: os.killpg(self.proc.pid, signal.SIGTERM)
            except Exception: pass
            try: self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try: os.killpg(self.proc.pid, signal.SIGKILL)
                except Exception: pass
                try: self.proc.wait(timeout=5)
                except Exception: pass
        try:
            if keep:
                with jar_lock(self.ws):
                    account = account_profile(self.ws)
                    write_cookies(self.ws, account, merge_cookies(read_cookies(account), self.seed, read_cookies(self.profile)))
                    # Site storage (localStorage) is taken over as the session left it.
                    storage = os.path.join(self.profile, "localStorage")
                    if os.path.isdir(storage):
                        shutil.copytree(storage, os.path.join(account, "localStorage"), dirs_exist_ok=True)
                        for root, dirs, files in os.walk(os.path.join(account, "localStorage")):
                            for name in dirs + files: _own_tree(self.ws, os.path.join(root, name))
        except Exception as error:
            log("browser profile merge failed:", repr(error))
        shutil.rmtree(self.profile, ignore_errors=True)


class Browsers:
    def __init__(self):
        self.lock = threading.Lock()
        self.items = {}
        threading.Thread(target=self.reap, daemon=True).start()

    def get(self, ws, session):
        key = f"{ws.caller}:{session}"
        stale = None
        with self.lock:
            item = self.items.get(key)
            if item and not item.alive(): stale, item = item, None
            if not item:
                item = BrowserSession(ws, session); self.items[key] = item
        if stale: threading.Thread(target=stale.close, daemon=True).start()
        return item

    def session_profile(self, ws, session):
        """The working folder of a running session, for downloads with its current cookies."""
        with self.lock:
            item = self.items.get(f"{ws.caller}:{session}")
            return item.profile if item and item.alive() else None

    def close_account(self, ws, keep):
        with self.lock:
            items = [(key, item) for key, item in self.items.items() if key.startswith(f"{ws.caller}:")]
            for key, _ in items: del self.items[key]
        for _, item in items: item.close(keep=keep)

    def close_all(self):
        with self.lock:
            items = list(self.items.values()); self.items.clear()
        for item in items: item.close()

    def reap(self):
        while True:
            time.sleep(60)
            cutoff = time.time() - CONFIG.idle_minutes * 60
            with self.lock:
                done = [(key, item) for key, item in self.items.items() if item.last < cutoff or not item.alive()]
                for key, _ in done: del self.items[key]
            for _, item in done: item.close()


BROWSERS = None


def cleanup_browser_profiles():
    """At start: working folders left by a stop, and the per-conversation profiles of older versions, are deleted."""
    roots = [os.path.join(CONFIG.home, "workspaces")]
    if IS_ROOT and SYSTEM == "Linux": roots.append("/home")
    removed = 0
    for base in roots:
        if not os.path.isdir(base): continue
        for entry in os.listdir(base):
            browser = os.path.join(base, entry, ".neuralnetui", "browser")
            if not os.path.isdir(browser): continue
            for name in os.listdir(browser):
                if name == "account": continue
                shutil.rmtree(os.path.join(browser, name), ignore_errors=True); removed += 1
    if removed: log(f"removed {removed} old browser profile folder(s)")


def browser_download(ws, session, url, out):
    """Streams a file Obscura fetches with the account's cookies (and a running session's newer ones) into `out`."""
    if not CONFIG.obscura: raise RuntimeError("Obscura is not installed on this computer.")
    with tempfile.TemporaryDirectory() as copy:
        with jar_lock(ws):
            if os.path.isdir(account_profile(ws)): shutil.copytree(account_profile(ws), copy, dirs_exist_ok=True)
        running = BROWSERS.session_profile(ws, session) if BROWSERS else None
        if running and os.path.isfile(os.path.join(running, "cookies.json")):
            write_cookies(ws, copy, merge_cookies(read_cookies(copy), [], read_cookies(running)))
        if ws.account: shutil.chown(copy, user=ws.account, group=ws.account)
        argv = [CONFIG.obscura] + (["--stealth"] if CONFIG.stealth else []) + ["fetch", url, "--dump", "original", "--quiet", "--storage-dir", copy, "--timeout", "120"]
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={**ws.env(), "RUST_LOG": "error"})
        total = 0
        for chunk in iter(lambda: proc.stdout.read(65536), b""):
            total += len(chunk); out(chunk)
        error = proc.stderr.read().decode("utf-8", "replace")
        if proc.wait() != 0: raise RuntimeError(error.strip().splitlines()[-1] if error.strip() else f"obscura exited {proc.returncode}")
        return total


# ------------------------------------------------------------------------------------------------ HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = f"NeuralNetUI-VM/{VERSION}"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    # -- helpers
    def reply(self, status, body=b"", content_type="application/json", headers=None):
        if isinstance(body, (dict, list)): body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type); self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items(): self.send_header(key, value)
        self.end_headers()
        if body: self.wfile.write(body)

    def authorized(self):
        supplied = self.headers.get("Authorization", "")
        token = supplied[7:] if supplied.lower().startswith("bearer ") else ""
        if CONFIG.key and token and hmac.compare_digest(token.encode(), CONFIG.key.encode()):
            return True
        self.reply(401, {"error": "Unauthorized"}, headers={"WWW-Authenticate": "Bearer"})
        return False

    def workspace(self):
        try: return workspace_for(self.headers.get("X-NNUI-User", ""))
        except PermissionError as error:
            self.reply(400, {"error": str(error)}); return None

    def body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    # -- routes
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            return self.reply(200, {"ok": True, "version": VERSION})
        if not self.authorized(): return
        if url.path in ("/mcp",) or url.path.startswith("/browser/"):
            return self.reply(405, {"error": "Use POST."}, headers={"Allow": "POST"})
        ws = self.workspace()
        if not ws: return
        query = parse_qs(url.query)
        if url.path == "/files":
            try:
                target = ws.resolve(query.get("path", [""])[0])
                if not os.path.isfile(target): return self.reply(404, {"error": "No such file."})
                size = os.path.getsize(target)
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream"); self.send_header("Content-Length", str(size))
                self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(os.path.basename(target))}")
                self.end_headers()
                with open(target, "rb") as handle: shutil.copyfileobj(handle, self.wfile, 1 << 16)
            except PermissionError as error: self.reply(403, {"error": str(error)})
            return
        if url.path == "/browser-cookies":
            with jar_lock(ws): cookies = read_cookies(account_profile(ws))
            return self.reply(200, {"cookiesTxt": cookies_to_netscape(cookies), "count": len(cookies)})
        if url.path == "/browser-download":
            session, target = query.get("session", [""])[0], query.get("url", [""])[0]
            if not re.match(r"^https?://", target): return self.reply(400, {"error": "An http(s) url is required."})
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream"); self.send_header("Transfer-Encoding", "chunked"); self.end_headers()
            def write(chunk):
                self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
            try:
                browser_download(ws, session or "default", target, write)
                self.wfile.write(b"0\r\n\r\n")
            except Exception as error:
                # A failure after the headers went out is signalled by a trailer-less abort: close without the final chunk.
                log("browser download failed:", error)
                self.close_connection = True
            return
        self.reply(404, {"error": "Not found."})

    def do_PUT(self):
        url = urlparse(self.path)
        if not self.authorized(): return
        ws = self.workspace()
        if not ws: return
        if url.path == "/browser-cookies": return self.put_cookies(ws)
        if url.path != "/files": return self.reply(404, {"error": "Not found."})
        try:
            target = ws.resolve(parse_qs(url.query).get("path", [""])[0])
            os.makedirs(os.path.dirname(target), exist_ok=True)
            remaining = int(self.headers.get("Content-Length") or 0)
            with open(target, "wb") as handle:
                while remaining > 0:
                    chunk = self.rfile.read(min(1 << 16, remaining))
                    if not chunk: break
                    handle.write(chunk); remaining -= len(chunk)
            ws.own(target)
            self.reply(200, {"path": target, "size": os.path.getsize(target)})
        except PermissionError as error: self.reply(403, {"error": str(error)})

    def put_cookies(self, ws):
        """Replaces the account's cookie jar with a cookies.txt. Running browsers are closed without merging their
        changes back, so the edit is what every next session starts from."""
        raw = self.body()
        if len(raw) > 4 << 20: return self.reply(413, {"error": "cookies.txt is larger than 4 MB."})
        text = raw.decode("utf-8", "replace")
        with jar_lock(ws): previous = read_cookies(account_profile(ws))
        cookies, problems = netscape_to_cookies(text, previous)
        if problems and not cookies and text.strip():
            return self.reply(400, {"error": "No cookie could be read from it.", "problems": problems[:20]})
        BROWSERS.close_account(ws, keep=False)
        with jar_lock(ws): write_cookies(ws, account_profile(ws), cookies)
        self.reply(200, {"count": len(cookies), "problems": problems[:20], "cookiesTxt": cookies_to_netscape(cookies)})

    def do_DELETE(self):
        if not self.authorized(): return
        self.reply(200, {})

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as error:
            log("request failed:", repr(error))
            try: self.reply(500, {"error": str(error)})
            except Exception: pass
            self.close_connection = True

    def do_POST(self):
        url = urlparse(self.path)
        if not self.authorized(): return
        ws = self.workspace()
        if not ws: return
        try: message = json.loads(self.body() or b"{}")
        except ValueError: return self.reply(400, {"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error"}})
        if isinstance(message, list):
            return self.reply(400, {"jsonrpc": "2.0", "error": {"code": -32600, "message": "Batches are not supported."}})
        if url.path == "/mcp": return self.mcp(ws, message)
        if url.path.startswith("/browser/"): return self.browser(ws, unquote(url.path[len("/browser/"):]), message)
        self.reply(404, {"error": "Not found."})

    def mcp(self, ws, message):
        method, ident, params = message.get("method"), message.get("id"), message.get("params") or {}
        if ident is None:
            return self.reply(202)
        if method == "initialize":
            requested = params.get("protocolVersion")
            version = requested if requested in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
            result = {"protocolVersion": version, "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": "neuralnetui-vm", "version": VERSION},
                      "instructions": "A virtual computer: run shell scripts, background jobs and (when it has a screen) screen and input tools in your own workspace."}
            return self.reply(200, {"jsonrpc": "2.0", "id": ident, "result": result}, headers={"Mcp-Session-Id": uuid.uuid4().hex})
        if method == "ping": return self.reply(200, {"jsonrpc": "2.0", "id": ident, "result": {}})
        if method == "tools/list": return self.reply(200, {"jsonrpc": "2.0", "id": ident, "result": {"tools": available_tools()}})
        if method != "tools/call": return self.reply(200, {"jsonrpc": "2.0", "id": ident, "error": {"code": -32601, "message": f"Method not found: {method}"}})
        name, args = params.get("name"), params.get("arguments") or {}
        token = (params.get("_meta") or {}).get("progressToken")
        wants_stream = "text/event-stream" in (self.headers.get("Accept") or "") and token is not None
        if not wants_stream:
            return self.reply(200, {"jsonrpc": "2.0", "id": ident, "result": self.run_tool(ws, name, args, None)})
        # Long calls stream progress notifications, which keep the caller's timeout from expiring.
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-cache"); self.send_header("Connection", "close"); self.end_headers()
        self.close_connection = True
        lock = threading.Lock()
        def event(payload):
            with lock:
                self.wfile.write(f"event: message\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()); self.wfile.flush()
        def progress(done, note):
            try: event({"jsonrpc": "2.0", "method": "notifications/progress", "params": {"progressToken": token, "progress": done, "message": note}})
            except Exception: pass
        result = self.run_tool(ws, name, args, progress)
        try: event({"jsonrpc": "2.0", "id": ident, "result": result})
        except Exception: pass

    def run_tool(self, ws, name, args, progress):
        try: return call_tool(ws, name, args, progress)
        except Exception as error:
            return {"content": [{"type": "text", "text": f"Error: {error}"}], "isError": True}

    def browser(self, ws, session, message):
        if message.get("id") is None:
            try: BROWSERS.get(ws, session).send(message)
            except Exception: pass
            return self.reply(202)
        try:
            response = BROWSERS.get(ws, session).send(message, timeout=180)
        except Exception as error:
            response = {"jsonrpc": "2.0", "id": message.get("id"), "error": {"code": -32000, "message": str(error)}}
        headers = {"Mcp-Session-Id": session} if message.get("method") == "initialize" else {}
        self.reply(200, response, headers=headers)


def main():
    global CONFIG, BROWSERS
    parser = argparse.ArgumentParser(description="NeuralNetUI virtual computer server")
    parser.add_argument("--config", default=os.environ.get("NNUI_VM_CONFIG", "/etc/neuralnetui-vm/config.json" if IS_ROOT else os.path.expanduser("~/.neuralnetui-vm/config.json")))
    parser.add_argument("--print-info", action="store_true", help="print what this computer offers and exit")
    options = parser.parse_args()
    CONFIG = Config(options.config)
    if options.print_info:
        print(json.dumps({"gui": gui_status(), "obscura": CONFIG.obscura, "os": SYSTEM, "root": IS_ROOT}, indent=2)); return
    if not CONFIG.key or len(CONFIG.key) < 16:
        sys.exit("An access key of at least 16 characters is required (NNUI_VM_KEY or \"key\" in the config file).")
    os.makedirs(CONFIG.home, mode=0o700, exist_ok=True)
    try: cleanup_browser_profiles()
    except Exception as error: log("browser profile cleanup failed:", repr(error))
    BROWSERS = Browsers()
    server = ThreadingHTTPServer((CONFIG.bind, CONFIG.port), Handler)
    server.daemon_threads = True
    log(f"NeuralNetUI virtual computer {VERSION} on http://{CONFIG.bind}:{CONFIG.port} ({SYSTEM}, gui: {gui_status()['available']}, obscura: {bool(CONFIG.obscura)})")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try: server.serve_forever()
    except (KeyboardInterrupt, SystemExit): pass
    finally: BROWSERS.close_all()   # keeps the running sessions' cookies


if __name__ == "__main__":
    main()
