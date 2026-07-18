import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CliError, EXIT } from "./errors.js";
import { loadToken, storeToken } from "./keyring.js";

const CONFIG_VERSION = 1;

export function defaultConfigPath() {
  const root = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return process.env.AFFINE_CLI_CONFIG || path.join(root, "affine-cli", "config.json");
}

export function defaultMcpConfigPath() {
  const root = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(root, "affine-mcp", "config");
}

function blankConfig() {
  return { version: CONFIG_VERSION, defaultProfile: null, profiles: {} };
}

export function normalizeBaseUrl(input) {
  let parsed;
  try {
    parsed = new URL(String(input || ""));
  } catch {
    throw new CliError(`Invalid AFFiNE base URL: ${input}`, { code: "INVALID_BASE_URL", exitCode: EXIT.CONFIG });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new CliError("AFFiNE base URL must use http or https.", { code: "INVALID_BASE_URL", exitCode: EXIT.CONFIG });
  }
  if (parsed.username || parsed.password) {
    throw new CliError("AFFiNE base URL must not contain embedded credentials.", { code: "INVALID_BASE_URL", exitCode: EXIT.CONFIG });
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
}

export function parseLegacyConfig(content) {
  const result = {};
  for (const line of String(content || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return result;
}

export async function loadConfig(configPath = defaultConfigPath()) {
  try {
    const parsed = JSON.parse(await fsp.readFile(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("config root is not an object");
    return {
      version: parsed.version || CONFIG_VERSION,
      defaultProfile: parsed.defaultProfile || null,
      profiles: parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {},
    };
  } catch (error) {
    if (error?.code === "ENOENT") return blankConfig();
    throw new CliError(`Failed to read config ${configPath}.`, {
      code: "CONFIG_READ_FAILED",
      exitCode: EXIT.CONFIG,
      details: { reason: error?.message || String(error) },
    });
  }
}

export async function saveConfig(config, configPath = defaultConfigPath()) {
  const dir = path.dirname(configPath);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, `.config.${process.pid}.tmp`);
  await fsp.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(temp, configPath);
  await fsp.chmod(configPath, 0o600);
}

export function readCodexAffineEnv() {
  const result = spawnSync("codex", ["mcp", "get", "affine", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return {};
  try {
    return JSON.parse(result.stdout)?.transport?.env || {};
  } catch {
    return {};
  }
}

function splitCsv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

export async function importMcpProfile({
  id = "default",
  sourcePath = defaultMcpConfigPath(),
  configPath = defaultConfigPath(),
  removeSource = false,
} = {}) {
  const fileVars = fs.existsSync(sourcePath) ? parseLegacyConfig(await fsp.readFile(sourcePath, "utf8")) : {};
  const codexVars = readCodexAffineEnv();
  const vars = { ...fileVars, ...codexVars };
  const token = vars.AFFINE_API_TOKEN;
  const baseUrl = vars.AFFINE_BASE_URL;
  if (!baseUrl || !token) {
    throw new CliError("Could not find both AFFINE_BASE_URL and AFFINE_API_TOKEN in the MCP configuration.", {
      code: "MCP_CONFIG_INCOMPLETE",
      exitCode: EXIT.CONFIG,
      details: { sourcePath, hasBaseUrl: !!baseUrl, hasToken: !!token },
    });
  }

  const config = await loadConfig(configPath);
  const credentialRef = storeToken(configPath, id, token);
  config.profiles[id] = {
    id,
    baseUrl: normalizeBaseUrl(baseUrl),
    workspaceId: vars.AFFINE_WORKSPACE_ID || null,
    toolProfile: vars.AFFINE_TOOL_PROFILE || "full",
    disabledTools: splitCsv(vars.AFFINE_DISABLED_TOOLS),
    disabledGroups: splitCsv(vars.AFFINE_DISABLED_GROUPS),
    credentialStore: "os-keychain",
    credentialRef,
  };
  config.defaultProfile = config.defaultProfile || id;
  await saveConfig(config, configPath);

  if (removeSource && fs.existsSync(sourcePath)) {
    await fsp.unlink(sourcePath);
  }

  return {
    id,
    baseUrl: config.profiles[id].baseUrl,
    workspaceId: config.profiles[id].workspaceId,
    toolProfile: config.profiles[id].toolProfile,
    disabledTools: config.profiles[id].disabledTools,
    credentialStore: "os-keychain",
    sourceRemoved: removeSource && !fs.existsSync(sourcePath),
    configPath,
  };
}

export async function addProfile({ id = "default", baseUrl, workspaceId, token, configPath = defaultConfigPath(), setDefault = false }) {
  const config = await loadConfig(configPath);
  const credentialRef = storeToken(configPath, id, token);
  config.profiles[id] = {
    id,
    baseUrl: normalizeBaseUrl(baseUrl),
    workspaceId: workspaceId || null,
    toolProfile: "full",
    disabledTools: [],
    disabledGroups: [],
    credentialStore: "os-keychain",
    credentialRef,
  };
  if (setDefault || !config.defaultProfile) config.defaultProfile = id;
  await saveConfig(config, configPath);
  return redactProfile(config.profiles[id]);
}

export function redactProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    baseUrl: profile.baseUrl,
    workspaceId: profile.workspaceId || null,
    toolProfile: profile.toolProfile || "full",
    disabledTools: profile.disabledTools || [],
    disabledGroups: profile.disabledGroups || [],
    credentialStore: profile.credentialStore || "os-keychain",
  };
}

export async function resolveProfile({ profileId, configPath = defaultConfigPath() } = {}) {
  const config = await loadConfig(configPath);
  const id = profileId || process.env.AFFINE_CLI_PROFILE || config.defaultProfile;
  let profile = id ? config.profiles[id] : null;

  if (!profile && process.env.AFFINE_BASE_URL && process.env.AFFINE_API_TOKEN) {
    profile = {
      id: "environment",
      baseUrl: normalizeBaseUrl(process.env.AFFINE_BASE_URL),
      workspaceId: process.env.AFFINE_WORKSPACE_ID || null,
      toolProfile: process.env.AFFINE_TOOL_PROFILE || "full",
      disabledTools: splitCsv(process.env.AFFINE_DISABLED_TOOLS),
      disabledGroups: splitCsv(process.env.AFFINE_DISABLED_GROUPS),
    };
    return { ...profile, token: process.env.AFFINE_API_TOKEN, configPath };
  }

  if (!profile) {
    throw new CliError("No AFFiNE CLI profile is configured.", {
      code: "PROFILE_NOT_FOUND",
      exitCode: EXIT.CONFIG,
      hint: "Run 'affine-cli profile import-mcp' to migrate the existing MCP configuration.",
    });
  }

  const token = process.env.AFFINE_API_TOKEN || loadToken(configPath, profile.id);
  return { ...profile, token, configPath };
}
