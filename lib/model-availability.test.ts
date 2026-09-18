import assert from "node:assert/strict";
import test from "node:test";
import { modelServerState, onlineReplacement, selectableState } from "./model-availability.ts";

const connections = [{ id: "a" }, { id: "b" }, { id: "c", disabled: true }];

test("a model takes its server's state and unchecked servers count as online", () => {
  const statuses = { a: "online" as const, b: "offline" as const };
  assert.equal(modelServerState({ connectionId: "a" }, connections, statuses), "online");
  assert.equal(modelServerState({ connectionId: "b" }, connections, statuses), "offline");
  assert.equal(modelServerState({ connectionId: "c" }, connections, { c: "online" }), "disabled");
  assert.equal(modelServerState({ connectionId: "a" }, connections, {}), "online");
  assert.equal(modelServerState({}, connections, statuses), "online");
  assert.equal(modelServerState({ connectionId: "a" }, connections, { a: "error" }), "error");
});

test("servers that answer with an error keep their models selectable", () => {
  assert.deepEqual((["online", "error", "offline", "disabled"] as const).map(selectableState), [true, true, false, false]);
});

test("an offline selection moves to the online default, then the first online model", () => {
  const online = [{ id: "m2" }, { id: "m3" }];
  assert.equal(onlineReplacement("m1", online, "m3")?.id, "m3");
  assert.equal(onlineReplacement("m1", online, "m1")?.id, "m2");
  assert.equal(onlineReplacement("m2", online, "m3"), undefined);
  assert.equal(onlineReplacement("m1", [], "m3"), undefined);
});
