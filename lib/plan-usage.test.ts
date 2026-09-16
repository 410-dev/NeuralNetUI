import assert from "node:assert/strict";
import test from "node:test";
import { anchoredWindow, weightedTokenUsage } from "./plan-usage.ts";

test("plan usage applies per-model weights to the selected token direction",()=>{const events=[{modelId:"fast",inputTokens:40,outputTokens:10},{modelId:"heavy",inputTokens:20,outputTokens:30}];assert.equal(weightedTokenUsage(events,"input",{heavy:2}),80);assert.equal(weightedTokenUsage(events,"output",{heavy:2}),70);assert.equal(weightedTokenUsage(events,"both",{heavy:2}),150);});
test("usage windows stay anchored to first use",()=>{const first=Date.UTC(2026,0,1),threeHours=3*3600;assert.deepEqual(anchoredWindow(first,first+7*3600_000,threeHours),{startsAt:first+6*3600_000,resetsAt:first+9*3600_000});});
