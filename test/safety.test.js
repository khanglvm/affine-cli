import test from "node:test";
import assert from "node:assert/strict";
import { assertToolAllowed, classifyTool } from "../src/safety.js";

test("read-only tools are allowed without action gates", () => {
  const tool = { name: "search_docs", annotations: { readOnlyHint: true } };
  assert.equal(classifyTool(tool).readOnly, true);
  assert.doesNotThrow(() => assertToolAllowed(tool, {}, {}));
});

test("write tools require the perform-action gate", () => {
  const tool = { name: "append_doc", annotations: { readOnlyHint: false } };
  assert.throws(
    () => assertToolAllowed(tool, {}, {}),
    (error) => error.details.required === "--perform-action",
  );
  assert.doesNotThrow(() => assertToolAllowed(tool, {}, { performAction: true }));
});

test("destructive tools require both gates", () => {
  const tool = { name: "delete_doc", annotations: { destructiveHint: true } };
  assert.throws(
    () => assertToolAllowed(tool, {}, { performAction: true }),
    (error) => error.details.required === "--allow-destructive",
  );
  assert.doesNotThrow(() => assertToolAllowed(tool, {}, {
    performAction: true,
    allowDestructive: true,
  }));
});

test("disabled tools remain blocked", () => {
  const tool = { name: "delete_doc", annotations: {} };
  assert.throws(
    () => assertToolAllowed(tool, { disabledTools: ["delete_doc"] }, { performAction: true, allowDestructive: true }),
    /disabled/,
  );
});
