# @khanglvm/affine-cli

Agent-optimized command-line access to AFFiNE. It exposes the full AFFiNE tool
surface on demand without permanently loading a large MCP schema into every
agent session.

## Provenance and license

This CLI is a port/adaptor of
[DAWNCR0W/affine-mcp-server](https://github.com/DAWNCR0W/affine-mcp-server).
The original project provides the AFFiNE GraphQL/WebSocket implementation and
MCP tool catalog. `affine-cli` depends on that package at runtime and adds a
compact CLI, secure profiles, deterministic JSON output, mutation gates,
large-result offloading, and an agent skill.

Both projects use the MIT License. Upstream copyright and attribution are
preserved in [NOTICE](./NOTICE). This project is independent and is not
affiliated with AFFiNE or the upstream maintainers.

## Install

```bash
npm install -g @khanglvm/affine-cli
affine-cli --version
```

## Migrate from an existing AFFiNE MCP connection

Import the existing `~/.config/affine-mcp/config` and Codex MCP environment.
The token moves into the OS keychain; the CLI config contains only non-secret
profile metadata.

```bash
affine-cli profile import-mcp --pretty
affine-cli profile test --pretty
```

After successful verification, remove the legacy credential file explicitly:

```bash
affine-cli profile import-mcp --remove-source --perform-action --pretty
```

Removing a Codex registration remains a separate, visible step:

```bash
codex mcp remove affine
```

## Agent-first usage

JSON is the default output. Logs and errors go to stderr. Large results are
written to mode-`0600` temporary files and returned as a compact preview.

```bash
affine-cli workspace list
affine-cli doc search --workspace <id> --query "meeting notes"
affine-cli doc read --workspace <id> --doc <id> --markdown
affine-cli tools list --query markdown
affine-cli tools describe append_markdown
affine-cli invoke export_doc_markdown \
  --args '{"workspaceId":"<id>","docId":"<id>"}'
```

Mutating tools require an explicit gate. Tools annotated destructive require a
second gate, while profile-disabled tools remain blocked:

```bash
affine-cli invoke append_markdown \
  --args '{"workspaceId":"<id>","docId":"<id>","markdown":"Update"}' \
  --perform-action
```

For multi-step automation, avoid repeated server startup:

```bash
affine-cli batch --stdin <<'JSON'
[
  {"tool":"list_workspaces","args":{}},
  {"tool":"list_docs","args":{"workspaceId":"<id>","limit":10}}
]
JSON
```

## Agent skill

The repository and npm package include `skills/affine-cli/SKILL.md`:

```bash
npx skills add https://github.com/khanglvm/affine-cli --skill affine-cli -y
affine-cli skill path
```

## Security

- Tokens are stored in the OS keychain, not the JSON config.
- Token input uses stdin to avoid shell history and process-list leakage.
- Tool annotations determine mutation gates; unknown annotations fail closed.
- Disabled tools imported from Codex stay disabled in the CLI runtime.
- Output files use mode `0600`.
- Errors omit stacks and redact secret-like detail keys.
