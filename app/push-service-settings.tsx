"use client";
import { BellRing, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Status = { configured: boolean; source?: "upload" | "file"; projectId?: string; clientEmail?: string; hostFile: boolean };

/**
 * The server's Firebase project for the mobile app's notifications. Each self-hosted server brings its own: the
 * superadmin uploads the service account key here, and the app is built with the same project's google-services.json.
 */
export function PushServiceCard({ ko, superadmin }: { ko: boolean; superadmin: boolean }) {
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { fetch("/api/push-service").then(response => response.ok ? response.json() : undefined).then(setStatus).catch(() => undefined); }, []);

  async function send(method: "PUT" | "DELETE", body?: string) {
    setBusy(true); setNotice(undefined);
    try {
      const response = await fetch("/api/push-service", { method, body, headers: body ? { "Content-Type": "application/json" } : undefined });
      const result = await response.json().catch(() => ({})) as Status & { error?: string };
      if (!response.ok) throw new Error(result.error || (ko ? "처리하지 못했습니다." : "Request failed."));
      setStatus(result);
      setNotice({ text: method === "PUT" ? (ko ? `키를 확인하고 저장했습니다. 프로젝트 '${result.projectId}'. 앱 알림이 바로 이 프로젝트로 나갑니다.` : `Key verified and saved for project '${result.projectId}'. App notifications use it right away.`)
        : result.configured ? (ko ? "올린 키를 지웠습니다. 서버 파일의 키를 대신 사용합니다." : "Uploaded key removed; the server's key file is used instead.") : (ko ? "키를 지웠습니다. 앱으로는 알림이 나가지 않습니다." : "Key removed. The app will not be notified.") });
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), error: true }); }
    finally { setBusy(false); }
  }

  const source = status?.source === "upload" ? (ko ? "웹에서 올린 키" : "uploaded here") : status?.source === "file" ? (ko ? "서버 파일" : "server file") : "";
  return <article className="backup-card push-service-card">
    <div>
      <strong><BellRing size={14} /> {ko ? "앱 푸시 알림 (Firebase)" : "App push notifications (Firebase)"}</strong>
      <small>{ko ? "모바일 앱으로 에이전트 알림을 보낼 때 쓰는 이 서버의 Firebase 프로젝트입니다. 앱은 같은 프로젝트의 google-services.json으로 빌드해야 합니다. 키는 다시 표시하지 않으며 백업 이미지에 포함되지 않습니다. data 폴더를 통째로 옮기면 함께 옮겨집니다."
        : "This server's Firebase project for agent notifications to the mobile app. Build the app with the same project's google-services.json. The key is never shown again and is not part of backup images; copying the whole data folder carries it along."}</small>
      <small className={`push-service-status ${status?.configured ? "on" : ""}`}>{!status ? (ko ? "불러오는 중…" : "Loading…")
        : status.configured ? `${ko ? "사용 중" : "In use"} · ${status.projectId} · ${status.clientEmail} · ${source}`
        : (ko ? "설정되지 않음 · 앱으로 알림이 나가지 않습니다" : "Not set · the app is not notified")}</small>
    </div>
    {superadmin ? <div className="backup-card-actions">
      <button className="secondary-button" disabled={busy} onClick={() => input.current?.click()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}{status?.source === "upload" ? (ko ? "키 바꾸기" : "Replace key") : (ko ? "서비스 계정 키 올리기" : "Upload service account key")}</button>
      {status?.source === "upload" && <button className="secondary-button danger" disabled={busy} onClick={() => void send("DELETE")}><Trash2 size={15} />{ko ? "올린 키 지우기" : "Remove uploaded key"}</button>}
      <input ref={input} hidden type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void file.text().then(text => send("PUT", text)); }} />
    </div> : <small>{ko ? "최고 관리자만 바꿀 수 있습니다." : "Only the superadmin can change it."}</small>}
    {notice && <p className={`settings-notice ${notice.error ? "error" : ""}`} role="status">{notice.text}</p>}
    {superadmin && !status?.configured && <small className="push-service-help">{ko ? "Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성에서 받은 JSON 파일을 올리세요. 올리면 Google에 로그인해 보고 맞는 키일 때만 저장합니다." : "Upload the JSON from Firebase console > Project settings > Service accounts > Generate new private key. It is checked by signing in to Google before it is saved."}</small>}
  </article>;
}
