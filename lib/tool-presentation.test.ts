import assert from "node:assert/strict";
import test from "node:test";

import { getToolDisplayName, getToolGroupState, getToolStatusLabel } from "./tool-presentation.ts";

test("known tool names are localized and unknown names remain readable", () => {
  assert.equal(getToolDisplayName("internet_search", "ko"), "인터넷 검색");
  assert.equal(getToolDisplayName("visit_page", "en"), "Page visit");
  assert.equal(getToolDisplayName("custom_data_lookup", "en"), "Custom data lookup");
});

test("tool status labels use active, completed, and failure wording", () => {
  assert.equal(getToolStatusLabel("internet_search", "calling", "ko"), "인터넷 검색 도구 사용 중");
  assert.equal(getToolStatusLabel("visit_page", "completed", "ko"), "페이지 방문 도구 사용함");
  assert.equal(getToolStatusLabel("get_current_time", "error", "en"), "Current time tool failed");
});

test("group state prioritizes active work, then errors, then completion", () => {
  assert.equal(getToolGroupState([{ status: "completed" }]), "completed");
  assert.equal(getToolGroupState([{ status: "completed" }, { status: "error" }]), "error");
  assert.equal(getToolGroupState([{ status: "error" }, { status: "waiting" }]), "active");
});
