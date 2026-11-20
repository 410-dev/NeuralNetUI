"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Cookie, Download, Globe2, LoaderCircle, RefreshCw, Trash2, TriangleAlert, Upload, Video } from "lucide-react";
import type { HarnessSettings, PublicConfig } from "@/lib/types";
import { DEFAULT_HARNESS_SETTINGS } from "@/lib/harness";
import { SectionTitle } from "./section-title";

type BinaryStatus = { kind: "obscura" | "obscura-worker"; installed: boolean; size?: number; updatedAt?: string; target?: string; matchesHost?: boolean };
type BrowserStatus = { host: string; binaries: BinaryStatus[]; ready: boolean; version?: string; error?: string; sessions: number };
type YtDlpStatus = { installed: boolean; version?: string; target?: string; matchesHost?: boolean; updatedAt?: string; ffmpeg: boolean; error?: string };
type CookieStatus = { present: boolean; updatedAt?: string; size?: number };

const sizeText = (bytes?: number) => bytes === undefined ? "" : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const dateText = (value: string | undefined, ko: boolean) => value ? new Date(value).toLocaleString(ko ? "ko-KR" : "en-US") : "";

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status})`);
  return body as T;
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`toggle ${checked ? "on" : ""}`} onClick={onChange}><i /></button>;
}

function NumberField({ label, help, value, min, max, onChange }: { label: string; help?: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}</span><input type="number" min={min} max={max} step={1} inputMode="numeric" value={value} onChange={event => onChange(Math.min(max, Math.max(min, Math.floor(Number(event.target.value) || min))))} />{help && <small>{help}</small>}</label>;
}

/**
 * Harness > Browser: the Obscura binaries (checked against this server's OS and CPU when uploaded), the render and
 * stealth switches, and how long an unused browser keeps its memory. Only Superadmin can change the binaries.
 */
export function BrowserHarnessSection({ draft, setDraft }: { draft: PublicConfig; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>> }) {
  const ko = draft.preferences.language === "ko";
  const superadmin = draft.account?.role === "superadmin";
  const h = { ...DEFAULT_HARNESS_SETTINGS, ...(draft.harnessSettings || {}) };
  const patch = (value: Partial<HarnessSettings>) => setDraft(d => ({ ...d, harnessSettings: { ...DEFAULT_HARNESS_SETTINGS, ...(d.harnessSettings || {}), ...value } }));
  const [status, setStatus] = useState<BrowserStatus>();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const load = () => fetch("/api/harness/browser", { cache: "no-store" }).then(readJson<BrowserStatus>).then(setStatus).catch(error => setNotice(error.message));
  useEffect(() => { void load(); }, []);

  async function upload(kind: BinaryStatus["kind"], file: File) {
    setBusy(kind); setNotice("");
    try {
      setStatus(await readJson<BrowserStatus>(await fetch(`/api/harness/browser?kind=${kind}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file })));
      setNotice(ko ? `${kind}을(를) 설치했습니다.` : `${kind} installed.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); const input = inputs.current[kind]; if (input) input.value = ""; }
  }
  async function remove(kind: BinaryStatus["kind"]) {
    setBusy(kind); setNotice("");
    try { setStatus(await readJson<BrowserStatus>(await fetch(`/api/harness/browser?kind=${kind}`, { method: "DELETE" }))); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }
  async function restart() {
    setBusy("restart"); setNotice("");
    try { setStatus(await readJson<BrowserStatus>(await fetch("/api/harness/browser", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restart" }) }))); setNotice(ko ? "실행 중인 브라우저 세션을 모두 종료했습니다." : "Every running browser session was stopped."); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }

  return <section className="settings-section wide managed-tool-section">
    <SectionTitle icon={<Globe2 size={19} />} title={ko ? "브라우저 (Obscura)" : "Browser (Obscura)"} description={ko
      ? "화면 없이 동작하는 내장 헤드리스 브라우저입니다. obscura와 obscura-worker 두 실행 파일을 넣으면 채팅의 도구 메뉴에 브라우저가 나타납니다."
      : "A built-in headless browser with no visible screen. Add both the obscura and obscura-worker executables and the browser appears in the chat tool menu."} />
    <div className="managed-binary-list">
      {(status?.binaries || [{ kind: "obscura", installed: false }, { kind: "obscura-worker", installed: false }] as BinaryStatus[]).map(binary => <div className={`managed-binary ${binary.installed ? (binary.matchesHost ? "ok" : "bad") : "missing"}`} key={binary.kind}>
        <div><strong>{binary.kind}</strong><small>{binary.installed
          ? <>{binary.matchesHost ? <Check size={12} /> : <TriangleAlert size={12} />}{binary.target} · {sizeText(binary.size)} · {dateText(binary.updatedAt, ko)}{!binary.matchesHost && (ko ? ` · 이 서버(${status?.host})와 맞지 않음` : ` · does not match this server (${status?.host})`)}</>
          : (ko ? "설치되지 않음" : "Not installed")}</small></div>
        {superadmin && <div className="managed-binary-actions">
          <input ref={element => { inputs.current[binary.kind] = element; }} type="file" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void upload(binary.kind, file); }} />
          <button type="button" className="subtle-action" disabled={Boolean(busy)} onClick={() => inputs.current[binary.kind]?.click()}>{busy === binary.kind ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}{binary.installed ? (ko ? "교체" : "Replace") : (ko ? "업로드" : "Upload")}</button>
          {binary.installed && <button type="button" className="subtle-action danger" disabled={Boolean(busy)} aria-label={ko ? `${binary.kind} 삭제` : `Remove ${binary.kind}`} onClick={() => void remove(binary.kind)}><Trash2 size={15} /></button>}
        </div>}
      </div>)}
    </div>
    <p className="settings-help">{status ? <>{ko ? `이 서버: ${status.host}` : `This server: ${status.host}`}{status.version ? ` · ${status.version}` : ""}{` · ${ko ? "실행 중인 세션" : "running sessions"} ${status.sessions}`}{status.error ? ` · ${status.error}` : ""}</> : (ko ? "상태를 불러오는 중…" : "Loading status…")}
      {" "}{ko ? "릴리스 압축 파일(github.com/h4ckf0r0day/obscura/releases)에 든 두 파일을 그대로 올립니다. 업로드할 때 서버의 운영체제·CPU와 맞는지 확인합니다." : "Upload both files from a release archive (github.com/h4ckf0r0day/obscura/releases). Each upload is checked against this server's OS and CPU."}</p>
    <div className="general-setting-card general-toggle-card"><div><strong>{ko ? "렌더링 (render)" : "Rendering (render)"}</strong><small>{ko ? "화면 캡처와 PDF 내보내기 도구를 모델에 제공합니다. 렌더링이 포함된 빌드에서만 동작하며, PDF는 개인 저장소에 저장됩니다." : "Offer screenshot and PDF export tools. Needs a rendering build; PDFs are saved to private storage."}</small></div><Toggle label={ko ? "렌더링" : "Rendering"} checked={h.browserRender} onChange={() => patch({ browserRender: !h.browserRender })} /></div>
    <div className="general-setting-card general-toggle-card"><div><strong>{ko ? "스텔스 (stealth)" : "Stealth (stealth)"}</strong><small>{ko ? "일관된 브라우저 지문과 추적기 차단을 켭니다(--stealth). stealth 빌드는 TLS 지문 위장도 함께 합니다. 바꾸면 다음 호출부터 새 세션으로 시작합니다." : "Consistent browser fingerprint and tracker blocking (--stealth); stealth builds also impersonate the TLS fingerprint. Sessions restart on their next call after a change."}</small></div><Toggle label={ko ? "스텔스" : "Stealth"} checked={h.browserStealth} onChange={() => patch({ browserStealth: !h.browserStealth })} /></div>
    <div className="harness-advanced"><h4>{ko ? "세션과 메모리" : "Sessions and memory"}</h4><div className="form-grid">
      <NumberField label={ko ? "유휴 후 종료(분)" : "Stop after idle (minutes)"} help={ko ? "대화의 브라우저를 이 시간 동안 쓰지 않으면 프로세스를 종료해 메모리를 회수합니다. 쿠키는 대화를 지울 때까지 남습니다." : "A chat's browser unused this long is stopped to reclaim memory. Its cookies stay until the chat is deleted."} value={h.browserIdleMinutes} min={1} max={240} onChange={browserIdleMinutes => patch({ browserIdleMinutes })} />
      <NumberField label={ko ? "동시 세션 수" : "Concurrent sessions"} help={ko ? "대화마다 별도 프로세스로 격리됩니다. 가득 차면 가장 오래 쉰 세션부터 종료합니다." : "Each chat gets its own isolated process. When full, the longest idle session is stopped first."} value={h.browserMaxSessions} min={1} max={64} onChange={browserMaxSessions => patch({ browserMaxSessions })} />
    </div>{superadmin && <button type="button" className="subtle-action" disabled={Boolean(busy)} onClick={() => void restart()}>{busy === "restart" ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{ko ? "모든 세션 종료" : "Stop all sessions"}</button>}</div>
    {notice && <p className="settings-notice" role="status">{notice}</p>}
  </section>;
}

/** Harness > YouTube: yt-dlp install/update from its official releases, transcript paging and the download cap. */
export function YoutubeHarnessSection({ draft, setDraft }: { draft: PublicConfig; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>> }) {
  const ko = draft.preferences.language === "ko";
  const superadmin = draft.account?.role === "superadmin";
  const h = { ...DEFAULT_HARNESS_SETTINGS, ...(draft.harnessSettings || {}) };
  const patch = (value: Partial<HarnessSettings>) => setDraft(d => ({ ...d, harnessSettings: { ...DEFAULT_HARNESS_SETTINGS, ...(d.harnessSettings || {}), ...value } }));
  const [status, setStatus] = useState<YtDlpStatus>();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [languages, setLanguages] = useState(h.youtubePreferredLanguages.join(", "));
  useEffect(() => { void fetch("/api/harness/yt-dlp", { cache: "no-store" }).then(readJson<YtDlpStatus>).then(setStatus).catch(error => setNotice(error.message)); }, []);
  async function update() {
    setBusy("update"); setNotice("");
    try { const next = await readJson<YtDlpStatus>(await fetch("/api/harness/yt-dlp", { method: "POST" })); setStatus(next); setNotice(ko ? `yt-dlp ${next.version || ""}을(를) 설치했습니다.` : `yt-dlp ${next.version || ""} installed.`); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }
  async function remove() {
    setBusy("remove"); setNotice("");
    try { setStatus(await readJson<YtDlpStatus>(await fetch("/api/harness/yt-dlp", { method: "DELETE" }))); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }
  return <section className="settings-section wide managed-tool-section">
    <SectionTitle icon={<Video size={19} />} title={ko ? "유튜브 (yt-dlp)" : "YouTube (yt-dlp)"} description={ko
      ? "유튜브 자막을 읽고 영상을 사용자의 개인 저장소로 내려받는 내장 도구입니다. yt-dlp가 설치되어 있어야 도구 메뉴에 나타납니다."
      : "A built-in tool that reads YouTube subtitles and downloads videos into each user's private storage. It appears in the tool menu once yt-dlp is installed."} />
    <div className="managed-binary-list"><div className={`managed-binary ${status?.installed ? (status.matchesHost && status.version ? "ok" : "bad") : "missing"}`}>
      <div><strong>yt-dlp</strong><small>{status ? (status.installed ? <>{status.version ? <Check size={12} /> : <TriangleAlert size={12} />}{status.version || status.error || "?"} · {status.target} · {dateText(status.updatedAt, ko)}</> : (ko ? "설치되지 않음" : "Not installed")) : (ko ? "불러오는 중…" : "Loading…")}</small></div>
      {superadmin && <div className="managed-binary-actions">
        <button type="button" className="subtle-action" disabled={Boolean(busy)} onClick={() => void update()}>{busy === "update" ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}{status?.installed ? (ko ? "최신 버전으로 업데이트" : "Update to latest") : (ko ? "설치" : "Install")}</button>
        {status?.installed && <button type="button" className="subtle-action danger" disabled={Boolean(busy)} aria-label={ko ? "yt-dlp 삭제" : "Remove yt-dlp"} onClick={() => void remove()}><Trash2 size={15} /></button>}
      </div>}
    </div></div>
    <p className="settings-help">{ko ? "github.com/yt-dlp/yt-dlp의 최신 안정 릴리스를 받아 체크섬과 서버 아키텍처를 확인한 뒤 교체합니다. 유튜브가 바뀌어 자막이나 다운로드가 실패하면 업데이트하세요." : "Downloads the latest stable release from github.com/yt-dlp/yt-dlp, verifies its checksum and architecture, then replaces the current one. Update when YouTube changes break subtitles or downloads."}
      {status && !status.ffmpeg && (ko ? " ffmpeg가 없어 영상과 오디오를 합칠 수 없으므로, 합쳐진 단일 파일 중 가장 좋은 화질로 받습니다." : " ffmpeg is missing, so videos are downloaded as the best single file instead of merged video and audio.")}</p>
    <div className="harness-advanced"><h4>{ko ? "자막과 다운로드" : "Subtitles and downloads"}</h4><div className="form-grid">
      <NumberField label={ko ? "한 번에 돌려줄 자막 글자 수" : "Transcript characters per call"} help={ko ? "더 긴 자막은 모델이 offset으로 이어서 가져옵니다." : "Longer transcripts are paged with offset."} value={h.youtubeMaxChars} min={2000} max={500000} onChange={youtubeMaxChars => patch({ youtubeMaxChars })} />
      <NumberField label={ko ? "영상 하나의 최대 크기(MB)" : "Maximum video size (MB)"} help={ko ? "개인 저장소에 남은 공간이 더 작으면 그 값이 한도입니다." : "When less space is left in private storage, that is the limit."} value={h.youtubeMaxDownloadMb} min={1} max={1024 * 1024} onChange={youtubeMaxDownloadMb => patch({ youtubeMaxDownloadMb })} />
      <label className="field"><span>{ko ? "선호 자막 언어" : "Preferred subtitle languages"}</span><input value={languages} onChange={event => setLanguages(event.target.value)} onBlur={() => { const list = languages.split(/[\s,]+/).map(item => item.trim()).filter(Boolean).slice(0, 20); patch({ youtubePreferredLanguages: list }); setLanguages(list.join(", ")); }} placeholder="ko, en" /><small>{ko ? "영상 원어 자막이 없을 때 이 순서로 고릅니다." : "Used in this order when the spoken language has no subtitles."}</small></label>
    </div></div>
    {status?.installed && <YoutubeCookies ko={ko} />}
    {notice && <p className="settings-notice" role="status">{notice}</p>}
  </section>;
}

/** Inside the yt-dlp section: the server's YouTube cookies, for videos that need a signed-in viewer. */
function YoutubeCookies({ ko }: { ko: boolean }) {
  const [status, setStatus] = useState<CookieStatus>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { void fetch("/api/harness/yt-dlp/cookies", { cache: "no-store" }).then(readJson<CookieStatus>).then(setStatus).catch(() => undefined); }, []);
  async function upload(file: File) {
    setBusy(true); setNotice("");
    try { setStatus(await readJson<CookieStatus>(await fetch("/api/harness/yt-dlp/cookies", { method: "PUT", headers: { "Content-Type": "text/plain" }, body: await file.text() }))); setNotice(ko ? "쿠키를 저장했습니다." : "Cookies saved."); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function remove() {
    setBusy(true); setNotice("");
    try { setStatus(await readJson<CookieStatus>(await fetch("/api/harness/yt-dlp/cookies", { method: "DELETE" }))); setNotice(ko ? "쿠키를 지웠습니다." : "Cookies removed."); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="harness-advanced youtube-cookies">
    <h4><Cookie size={14} aria-hidden="true" />{ko ? "쿠키" : "Cookies"}</h4>
    <p className="settings-help">{ko
      ? "로그인해야 볼 수 있는 영상이나 \"봇이 아님을 확인\" 오류가 날 때 필요합니다. 브라우저 확장으로 youtube.com 쿠키를 Netscape 형식(cookies.txt)으로 내보내 올립니다. 서버 전체의 유튜브 도구가 이 쿠키를 씁니다."
      : "Needed for videos that require signing in, or when YouTube asks to confirm you are not a bot. Export the youtube.com cookies in the Netscape format (cookies.txt) with a browser extension and upload them. The YouTube tool uses them for every account on this server."}</p>
    <div className="managed-binary-list"><div className={`managed-binary ${status?.present ? "ok" : "missing"}`}>
      <div><strong>cookies.txt</strong><small>{status?.present ? <><Check size={12} />{ko ? "저장됨" : "Saved"} · {sizeText(status.size)} · {dateText(status.updatedAt, ko)}</> : (ko ? "없음" : "None")}</small></div>
      <div className="managed-binary-actions">
        <input ref={input} type="file" accept=".txt,text/plain" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        <button type="button" className="subtle-action" disabled={busy} onClick={() => input.current?.click()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}{status?.present ? (ko ? "교체" : "Replace") : (ko ? "업로드" : "Upload")}</button>
        {status?.present && <button type="button" className="subtle-action danger" disabled={busy} aria-label={ko ? "쿠키 삭제" : "Remove cookies"} onClick={() => void remove()}><Trash2 size={15} /></button>}
      </div>
    </div></div>
    <p className="settings-help">{ko ? "쿠키는 로그인 정보와 같습니다. 서버에만 보관되며 다시 내려받을 수 없습니다. 개인 계정 대신 이 용도로 만든 계정의 쿠키를 쓰세요." : "Cookies are as sensitive as a login. They stay on the server and cannot be downloaded again. Use cookies from an account made for this purpose rather than a personal one."}</p>
    {notice && <p className="settings-notice" role="status">{notice}</p>}
  </div>;
}
