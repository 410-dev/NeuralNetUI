/** Starts server-side clocks when the server starts, not on the first request: the agent must run after a restart. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureAgentScheduler } = await import("./lib/agent/runtime");
  ensureAgentScheduler();
}
