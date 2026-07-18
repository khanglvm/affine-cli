import crypto from "node:crypto";
import path from "node:path";
import { Entry } from "@napi-rs/keyring";
import { CliError, EXIT } from "./errors.js";

const SERVICE = "com.khanglvm.affine-cli";

function accountFor(configPath, profileId) {
  const scope = crypto.createHash("sha256").update(path.resolve(configPath)).digest("hex").slice(0, 16);
  return `profile-token:${scope}:${profileId}`;
}

function entryFor(configPath, profileId) {
  return new Entry(SERVICE, accountFor(configPath, profileId));
}

export function storeToken(configPath, profileId, token) {
  if (!token) {
    throw new CliError("Cannot store an empty AFFiNE token.", { code: "TOKEN_REQUIRED", exitCode: EXIT.CONFIG });
  }
  try {
    entryFor(configPath, profileId).setPassword(String(token));
    return { service: SERVICE, account: accountFor(configPath, profileId) };
  } catch (error) {
    throw new CliError("Failed to store the AFFiNE token in the OS keychain.", {
      code: "KEYCHAIN_WRITE_FAILED",
      exitCode: EXIT.CONFIG,
      details: { keychainMessage: error?.message || String(error) },
    });
  }
}

export function loadToken(configPath, profileId) {
  try {
    const token = entryFor(configPath, profileId).getPassword();
    if (!token) throw new Error("empty credential");
    return token;
  } catch (error) {
    throw new CliError(`Credentials for profile '${profileId}' are missing from the OS keychain.`, {
      code: "KEYCHAIN_TOKEN_MISSING",
      exitCode: EXIT.CONFIG,
      details: { keychainMessage: error?.message || String(error) },
      hint: "Run 'affine-cli profile import-mcp' or 'affine-cli profile add --token-stdin'.",
    });
  }
}

export function deleteToken(configPath, profileId) {
  try {
    entryFor(configPath, profileId).deletePassword();
  } catch {
    // Removing a missing keychain entry is idempotent.
  }
}
