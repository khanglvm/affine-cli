import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const cli = path.resolve("bin/affine-cli.js");

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
}

test("help and version are available", () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Agent-optimized CLI/);

  const version = run(["--version"]);
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^0\.1\.1/);
});

test("tools can be discovered without a live AFFiNE request", () => {
  const result = run(["--result-mode", "inline", "tools", "list"], {
    AFFINE_BASE_URL: "https://example.invalid",
    AFFINE_API_TOKEN: "test-token",
  });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
  assert.ok(body.count > 50);
});

test("write gate fails before any API mutation", () => {
  const result = run(["invoke", "create_doc", "--args", "{}"], {
    AFFINE_BASE_URL: "https://example.invalid",
    AFFINE_API_TOKEN: "test-token",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--perform-action/);
});

test("usage errors emit one JSON line on stderr", () => {
  const result = run(["no-such-command"]);
  assert.equal(result.status, 2);
  const lines = result.stderr.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).error.code, "USAGE_ERROR");
});
