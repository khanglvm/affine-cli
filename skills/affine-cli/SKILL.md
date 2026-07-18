---
name: affine-cli
description: Use the local affine-cli to search, read, export, or safely update AFFiNE workspaces and documents, including note.khangle.dev. Trigger for AFFiNE knowledge lookup, document operations, workspace inspection, MCP-to-CLI migration, or discovering AFFiNE tool schemas.
---

# AFFiNE CLI

Use `affine-cli` for compact, machine-readable AFFiNE operations. It starts the upstream AFFiNE MCP runtime only for the duration of each command and emits JSON on stdout.

## Start with discovery

```bash
affine-cli profile show --pretty
affine-cli profile test --pretty
affine-cli workspace list --pretty
affine-cli tools list
affine-cli tools describe <tool-name> --pretty
```

Prefer the named `workspace` and `doc` commands for routine reads. Use `tools describe` before a raw invocation whose schema is unfamiliar.

## Read and search

```bash
affine-cli doc search --workspace <workspace-id> --query "search terms" --pretty
affine-cli doc read --workspace <workspace-id> --doc <doc-id> --pretty
affine-cli doc export --workspace <workspace-id> --doc <doc-id> --pretty
affine-cli invoke <tool-name> --args '{"key":"value"}' --pretty
```

For several independent calls, use a JSON batch file:

```bash
affine-cli batch --ops-file calls.json --pretty
```

Large results are automatically stored under the operating system's temporary directory in an `affine-cli-results` folder; follow the returned `file` path instead of asking the CLI to reprint the payload. Use `--result-mode inline` only when the full result is required in context.

## Safety protocol

1. Confirm the profile and workspace before operating.
2. Read the target before changing it.
3. Treat imported disabled tools as blocked.
4. Add `--perform-action` for any write.
5. Also add `--allow-destructive` for destructive operations.
6. Read the affected object after a write and verify the intended change.

Never pass an API token on the command line or place one in agent output. Profiles store tokens in the operating-system keychain and keep only non-secret settings in the config file.

## Migrate an existing MCP profile

```bash
affine-cli profile import-mcp --pretty
affine-cli profile test --pretty
```

Only after the CLI succeeds independently, remove the legacy source file with:

```bash
affine-cli profile import-mcp --remove-source --perform-action --pretty
```

Removing a Codex MCP registration is a separate final step and must happen only after live CLI verification.

## Output contract

- Success is a JSON object with `ok: true`.
- Failures are redacted JSON on stderr and use semantic exit codes.
- Keep stdout clean for piping and agent parsing.
- Use `--out <path>` when a stable artifact is needed.
