import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.NEURAL_CHAT_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "neural-secure-input-test-"));
const { secureInputTool } = await import("./secure-input-names.ts");

test("input tool names are recognised only under a virtual computer's namespace", () => {
  assert.equal(secureInputTool("mcp_72fc34ca_request_user_input"), "request");
  assert.equal(secureInputTool("mcp_72fc34ca_fill_held_input"), "fill");
  assert.equal(secureInputTool("request_user_input"), undefined);
  assert.equal(secureInputTool("mcp_72fc34ca_request_user_input_2"), undefined);
});

const { maskSecureInput, runSecureInputTool } = await import("./secure-input.ts");

function context(answer: unknown) {
  return { userId: "u1", conversationId: "c1", signal: new AbortController().signal, waitForUser: async () => answer } as unknown as Parameters<typeof runSecureInputTool>[2];
}

test("typed values fill the page or are held, and never come back to the model", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const browser = async (_user: string, _conversation: string, name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { content: [{ type: "text", text: `Filled with ${String(args.value)}` }] }; };
  const fields = [{ id: "email", label: "E-mail", kind: "email", selector: "#identifierId", submit: true }, { id: "password", label: "Password", kind: "password" }];
  const out = await runSecureInputTool("request_user_input", { title: "Google", fields }, context({ values: { email: "person@example.com", password: "s3cret-Pass" } }), browser);
  const text = JSON.stringify(out);
  assert.ok(!text.includes("person@example.com") && !text.includes("s3cret-Pass"));
  assert.deepEqual(calls.map(call => call.name), ["browser_fill", "browser_press_key"]);
  assert.equal(calls[0].args.value, "person@example.com");
  const result = out.result as { fields: Array<{ status: string; handle?: string }> };
  assert.equal(result.fields[0].status, "filled");
  assert.equal(result.fields[1].status, "held");
  // a page showing the values back is masked for the model
  assert.equal(maskSecureInput("c1", { text: "user person@example.com pw s3cret-Pass" }).text, "user [hidden input] pw [hidden input]");
  assert.equal(maskSecureInput("other", "s3cret-Pass"), "s3cret-Pass");
  // the held password is filled once, then gone
  const handle = result.fields[1].handle!;
  const filled = await runSecureInputTool("fill_held_input", { handle, selector: "input[type=password]" }, context(undefined), browser);
  assert.equal((filled.result as { status: string }).status, "filled");
  assert.equal(calls.at(-1)!.args.value, "s3cret-Pass");
  const again = await runSecureInputTool("fill_held_input", { handle, selector: "input[type=password]" }, context(undefined), browser);
  assert.equal((again.result as { status: string }).status, "expired");
  // another conversation cannot use a handle
  const other = await runSecureInputTool("request_user_input", { title: "x", fields: [{ id: "a", label: "A", kind: "otp" }] }, context({ values: { a: "123456" } }), browser);
  const otherHandle = (other.result as { fields: Array<{ handle: string }> }).fields[0].handle;
  const stolen = await runSecureInputTool("fill_held_input", { handle: otherHandle, selector: "#x" }, { ...context(undefined), conversationId: "c2" } as never, browser);
  assert.equal((stolen.result as { status: string }).status, "expired");
});

test("a closed card is reported as cancelled", async () => {
  const out = await runSecureInputTool("request_user_input", { title: "x", fields: [{ id: "a", label: "A", kind: "text" }] }, context({ cancelled: true }), async () => ({}));
  assert.equal((out.result as { status: string }).status, "cancelled");
});
