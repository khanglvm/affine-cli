import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ResultStore } from "../src/result-store.js";

test("explicit result files are private", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "affine-cli-result-"));
  const output = path.join(dir, "result.json");
  const store = new ResultStore();
  await store.emit({ ok: true, value: "hello" }, { outputFile: output });
  const stat = await fs.stat(output);
  assert.equal(stat.mode & 0o777, 0o600);
});

test("existing result files are tightened to mode 0600", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "affine-cli-result-existing-"));
  const output = path.join(dir, "result.json");
  await fs.writeFile(output, "old\n", { mode: 0o644 });
  await fs.chmod(output, 0o644);
  const store = new ResultStore();
  await store.emit({ ok: true }, { outputFile: output });
  const stat = await fs.stat(output);
  assert.equal(stat.mode & 0o777, 0o600);
});
