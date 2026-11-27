import { test } from "node:test";
import assert from "node:assert/strict";
import { BASIC_CATALOG_ID } from "./catalog.ts";
import { a2uiSurfaces, interpolate, resolveString, runChecks, setAt, getAt } from "./runtime.ts";
import { validateMessages } from "./validate.ts";
import type { ToolEvent } from "../types.ts";

const create = (components: unknown[], extra: Record<string, unknown> = {}) => [{ version: "1.0", createSurface: { surfaceId: "s1", catalogId: BASIC_CATALOG_ID, components, dataModel: { user: { name: "Ada" }, items: [{ n: "a" }, { n: "b" }] }, ...extra } }];

test("a complete A2UI v1.0 surface validates", () => {
  const outcome = validateMessages(create([
    { id: "root", component: "Card", child: "col" },
    { id: "col", component: "Column", children: ["hello", "list", "go"] },
    { id: "hello", component: "Text", text: { "@call": "formatString", args: { value: "Hi ${/user/name}" } } },
    { id: "list", component: "List", children: { componentId: "item", path: "/items" } },
    { id: "item", component: "Text", text: { "@path": "n" } },
    { id: "go_label", component: "Text", text: "Go" },
    { id: "go", component: "Button", child: "go_label", variant: "primary", action: { event: { name: "go", context: { who: { "@path": "/user/name" } } } } },
  ]), {});
  assert.deepEqual(outcome.errors, []);
  assert.deepEqual(outcome.touched, ["s1"]);
});

test("validation explains unknown components, missing roots, dangling ids and v0.9 bindings", () => {
  const outcome = validateMessages(create([
    { id: "top", component: "Column", children: ["x", "ghost"] },
    { id: "x", component: "Fancy" },
    { id: "t", component: "Text", text: { path: "/user/name" } },
  ]), {});
  const text = outcome.errors.join("\n");
  assert.match(text, /unknown component "Fancy"/);
  assert.match(text, /no component with id "root"/);
  assert.match(text, /\{"@path": "..."\} \(v1\.0\)/);
});

test("updates must target an existing surface; history from accepted calls counts", () => {
  assert.match(validateMessages([{ version: "1.0", updateDataModel: { surfaceId: "nope", path: "/a", value: 1 } }], {}).errors[0], /does not exist/);
  const events: ToolEvent[] = [{ id: "e1", name: "render_ui", status: "completed", startedAt: "", arguments: { messages: create([{ id: "root", component: "Text", text: "x" }]) }, result: { ok: true } }];
  const surfaces = a2uiSurfaces(events);
  assert.equal(surfaces.s1.createdBy, "e1");
  assert.deepEqual(validateMessages([{ version: "1.0", updateDataModel: { surfaceId: "s1", path: "/user/name", value: "Bo" } }], surfaces).errors, []);
  assert.match(validateMessages(create([{ id: "root", component: "Text", text: "again" }]), surfaces).errors[0], /already exists/);
});

test("expressions, bindings and checks evaluate", () => {
  const model = setAt({ user: { name: "Ada" }, total: 1234.5, email: "bad" }, "/user/age", 36);
  assert.equal(getAt(model, "/user/age"), 36);
  const scope = { model, scope: "", locale: "en-US" };
  assert.equal(interpolate("Hi ${/user/name} (${/user/age})", scope), "Hi Ada (36)");
  assert.equal(interpolate("${formatCurrency(value: ${/total}, currency: 'USD')}", scope), "$1,234.50");
  assert.equal(interpolate("escaped \\${x}", scope), "escaped ${x}");
  assert.equal(resolveString({ "@call": "pluralize", args: { value: 1, one: "one item", other: "many items" } }, scope), "one item");
  const failed = runChecks([{ condition: { "@call": "email", args: { value: { "@path": "/email" } } }, message: "Bad email" }], scope);
  assert.deepEqual(failed, { valid: false, message: "Bad email" });
  assert.equal(runChecks([{ condition: { "@call": "and", args: { values: [{ "@call": "required", args: { value: { "@path": "/user/name" } } }, true] } } }], scope).valid, true);
});
