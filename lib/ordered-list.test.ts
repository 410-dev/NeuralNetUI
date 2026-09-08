import assert from "node:assert/strict";
import test from "node:test";
import { applyPreferredOrder, moveItemById, nudgeItemById } from "./ordered-list.ts";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("moves an item to a dropped item's position", () => {
  assert.deepEqual(moveItemById(items, "c", "a").map(({ id }) => id), ["c", "a", "b"]);
  assert.deepEqual(moveItemById(items, "missing", "a"), items);
});

test("nudges an item by one position and respects boundaries", () => {
  assert.deepEqual(nudgeItemById(items, "b", -1).map(({ id }) => id), ["b", "a", "c"]);
  assert.deepEqual(nudgeItemById(items, "c", 1), items);
});

test("applies saved order while leaving newly discovered items stable at the end", () => {
  assert.deepEqual(applyPreferredOrder(items, ["c", "a"]).map(({ id }) => id), ["c", "a", "b"]);
});
