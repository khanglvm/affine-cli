import test from "node:test";
import assert from "node:assert/strict";
import { preflightBatchOperations } from "../src/mcp-client.js";

test("a batch is completely preflighted before execution", async () => {
  const tools = [
    { name: "read_doc", annotations: { readOnlyHint: true } },
    { name: "create_doc", annotations: { readOnlyHint: false } },
  ];
  const checked = [];
  await assert.rejects(
    preflightBatchOperations(tools, [
      { tool: "read_doc", args: { docId: "one" } },
      { tool: "create_doc", args: { title: "blocked" } },
    ], async (tool) => {
      checked.push(tool.name);
      if (tool.name === "create_doc") throw new Error("gated");
    }),
    /gated/,
  );
  assert.deepEqual(checked, ["read_doc", "create_doc"]);
});

test("a late unknown tool rejects during preflight", async () => {
  await assert.rejects(
    preflightBatchOperations([{ name: "read_doc" }], [
      { tool: "read_doc" },
      { tool: "does_not_exist" },
    ]),
    /batch index 1/,
  );
});
