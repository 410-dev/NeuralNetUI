import type { ToolCallContext } from "./types.ts";

/**
 * Approval before a tool call runs, shared by every provider. "session_ask" approvals are remembered per
 * conversation for 12 hours or until the conversation is deleted. The store lives on globalThis so every route
 * bundle in the server process sees the same approvals.
 */
export type ApprovalPolicy = "allow" | "always_ask" | "session_ask" | "blocked";

declare global { var neuralToolApprovals: Map<string, number> | undefined; }
const approvals = globalThis.neuralToolApprovals ??= new Map<string, number>();
const SESSION_APPROVAL_MS = 12 * 60 * 60 * 1000;

const scope = (userId: string, conversationId: string) => `${userId}:${conversationId}:`;

function prune() {
  const cutoff = Date.now() - SESSION_APPROVAL_MS;
  for (const [key, stamp] of approvals) if (stamp < cutoff) approvals.delete(key);
}

export function clearSessionApprovals(userId: string, conversationId: string) {
  const prefix = scope(userId, conversationId);
  for (const key of approvals.keys()) if (key.startsWith(prefix)) approvals.delete(key);
}

export type ApprovalDecision = { approved: boolean; decision: string; response: Record<string, unknown> };

/**
 * Asks the person when the policy requires it. `present` records the card on the tool event (it is shown while the
 * call waits). `subject` names what a session approval covers, such as "<connection>:<tool>".
 */
export async function requestApproval(ctx: ToolCallContext, subject: string, policy: ApprovalPolicy, present: () => void): Promise<ApprovalDecision> {
  if (policy === "allow") return { approved: true, decision: "approve", response: {} };
  if (policy === "blocked") return { approved: false, decision: "blocked", response: {} };
  prune();
  const key = `${scope(ctx.userId, ctx.conversationId)}${subject}`;
  if (policy === "session_ask" && approvals.has(key)) return { approved: true, decision: "approve", response: {} };
  present();
  const raw = await ctx.waitForUser();
  const response = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const decision = String(response.decision || "reject");
  if (decision === "approve" && policy === "session_ask") approvals.set(key, Date.now());
  return { approved: decision === "approve", decision, response };
}
