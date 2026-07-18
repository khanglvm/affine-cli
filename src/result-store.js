import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function safeLabel(value) {
  return String(value || "result").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
}

function preview(value, depth = 0) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  if (Array.isArray(value)) {
    if (depth >= 2) return { type: "array", count: value.length };
    return value.slice(0, 3).map((item) => preview(item, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (depth >= 2) return { type: "object", keys: entries.slice(0, 12).map(([key]) => key) };
    return Object.fromEntries(entries.slice(0, 12).map(([key, item]) => [key, preview(item, depth + 1)]));
  }
  return String(value);
}

export class ResultStore {
  constructor({ mode = "auto", inlineMaxBytes = 16_000, tmpDir, pretty = false } = {}) {
    this.mode = mode;
    this.inlineMaxBytes = Number(inlineMaxBytes) || 16_000;
    this.tmpDir = tmpDir || path.join(os.tmpdir(), "affine-cli-results");
    this.pretty = pretty;
  }

  async emit(value, { label = "result", outputFile } = {}) {
    const serialized = JSON.stringify(value, null, this.pretty ? 2 : 0);
    const bytes = Buffer.byteLength(serialized);

    if (outputFile) {
      await fs.mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
      await fs.writeFile(outputFile, `${serialized}\n`, { mode: 0o600 });
      process.stdout.write(`${JSON.stringify({ ok: true, stored: true, file: path.resolve(outputFile), bytes })}\n`);
      return;
    }

    const shouldStore = this.mode === "file" || (this.mode === "auto" && bytes > this.inlineMaxBytes);
    if (!shouldStore) {
      process.stdout.write(`${serialized}\n`);
      return;
    }

    await fs.mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(this.tmpDir, `${stamp}-${safeLabel(label)}.json`);
    await fs.writeFile(file, `${serialized}\n`, { mode: 0o600 });
    const envelope = {
      ok: true,
      stored: true,
      file,
      bytes,
      preview: preview(value),
      hint: `Inspect only if needed: jq '.' ${JSON.stringify(file)}`,
    };
    process.stdout.write(`${JSON.stringify(envelope, null, this.pretty ? 2 : 0)}\n`);
  }
}
