import assert from "node:assert/strict";
import test from "node:test";

import { formatReasoningForDisplay, getToolDisplayName, getToolGroupLabel, getToolGroupState, getToolStatusLabel } from "./tool-presentation.ts";

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

test("group labels include active tool names and completed failure counts", () => {
  assert.equal(getToolGroupLabel([
    { name: "internet_search", status: "calling" },
    { name: "visit_page", status: "completed" },
  ], "ko"), "도구 사용 중: 인터넷 검색");
  assert.equal(getToolGroupLabel([
    { name: "internet_search", status: "completed" },
    { name: "visit_page", status: "completed" },
  ], "ko"), "2개의 도구 사용함");
  assert.equal(getToolGroupLabel([
    { name: "internet_search", status: "error" },
    { name: "visit_page", status: "completed" },
  ], "ko"), "2개의 도구 사용함 (1개 실패)");
  assert.equal(getToolGroupLabel([{ name: "internet_search", status: "completed" }], "en"), "Used 1 tool");
});

test("reasoning call markers are localized, ordered, and display-only", () => {
  const reasoning = "Check sources.\nCompare results.";
  const displayed = formatReasoningForDisplay(reasoning, [
    { name: "internet_search", reasoningOffset: 14 },
    { name: "visit_page", reasoningOffset: 14 },
  ], "ko");
  assert.equal(displayed, "Check sources.\n[인터넷 검색 도구 호출함]\n[페이지 방문 도구 호출함]\nCompare results.");
  assert.equal(reasoning, "Check sources.\nCompare results.");
  assert.equal(formatReasoningForDisplay("Done", [{ name: "internet_search" }], "en"), "Done\n[Called internet search tool]");
});
