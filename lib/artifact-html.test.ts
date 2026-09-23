import assert from "node:assert/strict";
import test from "node:test";
import { artifactHtmlWithStorage, artifactStorageEntries } from "./artifact-html.ts";

test("storage bootstrap precedes authored JavaScript and escapes stored markup",()=>{
  const document=artifactHtmlWithStorage('<!doctype html><html><head><script>window.result=localStorage.getItem("x")</script></head></html>',{x:'</script><script>window.pwned=1</script>'});
  assert.ok(document.indexOf('const values=new Map')<document.indexOf('window.result='));
  assert.ok(document.includes('\\u003c/script>'));
  assert.equal(document.includes('value:window.pwned'),false);
  const malformed=artifactHtmlWithStorage('<script>window.result=localStorage.length</script><head></head>',{});
  assert.ok(malformed.indexOf('const values=new Map')<malformed.indexOf('window.result='));
});

test("storage messages accept only bounded string dictionaries",()=>{
  assert.deepEqual(artifactStorageEntries({a:"1"}),{a:"1"});
  assert.equal(artifactStorageEntries({a:1}),undefined);
  assert.equal(artifactStorageEntries({a:"x".repeat(1048577)}),undefined);
});
