import assert from "node:assert/strict";
import test from "node:test";

import { pageVisitHeaders } from "./page-visit-request.ts";

test("page visits identify NeuralChat with a browser-compatible user agent", () => {
  const headers = pageVisitHeaders();

  assert.match(headers["User-Agent"], /^Mozilla\/5\.0 .* AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36 NeuralChat\/\d+\.\d+\.\d+(?:[-.][0-9A-Za-z]+)*$/);
  assert.match(headers.Accept, /text\/html/);
  assert.match(headers["Accept-Language"], /en-US/);
});
