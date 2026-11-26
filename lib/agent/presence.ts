/**
 * Whether the person is looking at the agent right now, on any device. The agent screen reports while it is visible;
 * a report older than the window means nobody is looking, and messages then go out as push notifications.
 */
declare global { var neuralAgentPresence: Map<string, Map<string, number>> | undefined; }
const presence = globalThis.neuralAgentPresence ??= new Map<string, Map<string, number>>();
export const PRESENCE_WINDOW_MS = 45_000;

export function reportAgentPresence(userId: string, deviceId: string, visible: boolean, at = Date.now()) {
  const devices = presence.get(userId) ?? new Map<string, number>();
  if (visible) devices.set(deviceId.slice(0, 100), at); else devices.delete(deviceId.slice(0, 100));
  if (devices.size) presence.set(userId, devices); else presence.delete(userId);
}

export function isViewingAgent(userId: string, at = Date.now()) {
  const devices = presence.get(userId);
  if (!devices) return false;
  for (const [device, seen] of devices) { if (at - seen <= PRESENCE_WINDOW_MS) return true; devices.delete(device); }
  return false;
}
