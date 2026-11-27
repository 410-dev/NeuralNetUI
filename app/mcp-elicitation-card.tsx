"use client";
import { Check, Cable, X } from "lucide-react";
import { useState } from "react";
import type { ToolEvent } from "@/lib/types";
import type { ElicitationAnswer, ElicitationField } from "@/lib/mcp-stateless";

/**
 * An MCP server asking the person something before a tool may go on (form elicitation): Google's Workspace servers
 * ask whether the app may use the data a call touches. A single choice field becomes one button per option; other
 * fields become a small form. The answer goes back to the server, never to the model.
 */
export function McpElicitationComposer({ ko, event, onSubmit }: { ko: boolean; event: ToolEvent; onSubmit: (value: ElicitationAnswer) => Promise<boolean> }) {
  const args = event.arguments && typeof event.arguments === "object" ? event.arguments as Record<string, unknown> : {};
  const request = (args._mcpElicitation && typeof args._mcpElicitation === "object" ? args._mcpElicitation : {}) as { connectionName?: string; toolName?: string; message?: string; fields?: ElicitationField[] };
  const fields = Array.isArray(request.fields) ? request.fields : [];
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const send = async (answer: ElicitationAnswer) => { setBusy(true); if (!await onSubmit(answer)) setBusy(false); };
  const single = fields.length === 1 && fields[0].type === "enum" ? fields[0] : undefined;
  const ready = fields.every(field => !field.required || (values[field.key] !== undefined && values[field.key] !== ""));
  return <section className="choice-composer-card mcp-approval-card mcp-elicitation-card" aria-label={ko ? "MCP 승인 요청" : "MCP approval request"}>
    <header className="mcp-approval-head"><span className="mcp-approval-title"><Cable size={15} /><strong>{ko ? "MCP 서버가 확인을 요청합니다" : "The MCP server asks you"}</strong></span><small>{request.connectionName || "MCP"}{request.toolName ? ` · ${request.toolName}` : ""}</small></header>
    <div className="host-approval-body">
      {request.message && <p className="mcp-elicitation-message">{request.message.replace(/\*\*|__|`/g, "")}</p>}
      {single ? <>{single.title && <p className="mcp-elicitation-question">{single.title}</p>}
        <div className="mcp-elicitation-options">{(single.options || []).map(option => <button key={option.value} type="button" disabled={busy} className={/^DENY|^DON'?T|^REJECT/i.test(option.value) ? "deny" : ""} onClick={() => void send({ action: "accept", content: { [single.key]: option.value } })}>{option.label}</button>)}</div></>
        : <div className="mcp-elicitation-form">{fields.map(field => <label key={field.key} className="field"><span>{field.title || field.key}{field.required ? " *" : ""}</span>
          {field.type === "enum" ? <select value={String(values[field.key] ?? "")} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}><option value="" disabled>{ko ? "선택" : "Choose"}</option>{(field.options || []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            : field.type === "boolean" ? <input type="checkbox" checked={values[field.key] === true} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.checked }))} />
            : <input type={field.type === "number" ? "number" : "text"} value={String(values[field.key] ?? "")} onChange={event => setValues(current => ({ ...current, [field.key]: field.type === "number" ? Number(event.target.value) : event.target.value }))} />}
          {field.description && <small>{field.description}</small>}</label>)}</div>}
    </div>
    <footer className="host-approval-actions">{!single && <button type="button" disabled={busy || !ready} onClick={() => void send({ action: "accept", content: values })}><Check size={15} />{ko ? "보내기" : "Send"}</button>}<button type="button" disabled={busy} onClick={() => void send({ action: "decline" })}><X size={15} />{ko ? "거절" : "Decline"}</button></footer>
  </section>;
}
