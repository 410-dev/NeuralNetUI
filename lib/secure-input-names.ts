/** Names of the virtual computer's input tools, safe to import in the browser. */
export const REQUEST_INPUT_TOOL = "request_user_input";
export const FILL_HELD_TOOL = "fill_held_input";

/** Which input tool an advertised name is (the virtual computer's tools are namespaced as mcp_<id>_<name>). */
export function secureInputTool(name: string): "request" | "fill" | undefined {
  const match = /^mcp_[0-9a-f]{8}_(request_user_input|fill_held_input)$/.exec(name);
  return match ? (match[1] === REQUEST_INPUT_TOOL ? "request" : "fill") : undefined;
}

export type SecureInputKind = "text" | "email" | "username" | "password" | "otp";
export type SecureInputField = { id: string; label: string; kind: SecureInputKind; ref?: string; selector?: string; submit?: boolean };
export const SECRET_KINDS: readonly SecureInputKind[] = ["password", "otp"];
