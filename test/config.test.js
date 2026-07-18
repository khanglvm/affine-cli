import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBaseUrl, parseLegacyConfig, saveConfig } from "../src/config.js";

test("legacy affine-mcp config is parsed", () => {
  const parsed = parseLegacyConfig("AFFINE_BASE_URL=https://note.example.test\nAFFINE_API_TOKEN=secret\n");
  assert.equal(parsed.AFFINE_BASE_URL, "https://note.example.test");
  assert.equal(parsed.AFFINE_API_TOKEN, "secret");
});

test("base URLs reject embedded credentials", () => {
  assert.throws(
    () => normalizeBaseUrl("https://user:secret@example.test"),
    /credential/i,
  );
});

test("config files are private and contain no token", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "affine-cli-config-"));
  const configPath = path.join(dir, "config.json");
  await saveConfig({ version: 1, defaultProfile: "default", profiles: { default: { baseUrl: "https://example.test" } } }, configPath);
  const content = await fs.readFile(configPath, "utf8");
  const stat = await fs.stat(configPath);
  assert.equal(stat.mode & 0o777, 0o600);
  assert.equal(content.includes("secret"), false);
});
