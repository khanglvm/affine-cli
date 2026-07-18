import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { Command, CommanderError } from "commander";
import {
  addProfile,
  defaultConfigPath,
  defaultMcpConfigPath,
  importMcpProfile,
  loadConfig,
  redactProfile,
  resolveProfile,
} from "./config.js";
import { CliError, EXIT, errorEnvelope, exitCodeFor } from "./errors.js";
import { invokeBatch, invokeTool, listTools } from "./mcp-client.js";
import { ResultStore } from "./result-store.js";
import { assertToolAllowed, classifyTool } from "./safety.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

function commandOptions(command) {
  return command.optsWithGlobals ? command.optsWithGlobals() : command.opts();
}

function storeFrom(command) {
  const opts = commandOptions(command);
  return new ResultStore({
    mode: opts.resultMode,
    inlineMaxBytes: opts.inlineMaxBytes,
    tmpDir: opts.tmpDir,
    pretty: !!opts.pretty,
  });
}

async function emit(command, value, label) {
  await storeFrom(command).emit(value, { label, outputFile: commandOptions(command).out });
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new CliError(`Invalid JSON for ${label}.`, {
      code: "INVALID_JSON",
      exitCode: EXIT.USAGE,
      details: { reason: error?.message || String(error) },
    });
  }
}

async function readPayload(options, { plural = false } = {}) {
  const direct = plural ? options.ops : options.args;
  const file = plural ? options.opsFile : options.argsFile;
  if ([direct !== undefined, file !== undefined, !!options.stdin].filter(Boolean).length > 1) {
    throw new CliError("Choose only one JSON input source.", { code: "AMBIGUOUS_INPUT", exitCode: EXIT.USAGE });
  }
  if (direct !== undefined) return parseJson(direct, plural ? "--ops" : "--args");
  if (file !== undefined) return parseJson(await fs.readFile(file, "utf8"), file);
  if (options.stdin) return parseJson(await readStdin(), "stdin");
  return plural ? [] : {};
}

async function runtime(command) {
  const opts = commandOptions(command);
  const configPath = opts.config || defaultConfigPath();
  const profile = await resolveProfile({ profileId: opts.profile, configPath });
  return { opts, profile, configPath };
}

async function executeTool(command, name, args, gateOptions = {}) {
  const { profile } = await runtime(command);
  const started = Date.now();
  const response = await invokeTool(profile, name, args, (tool) => {
    assertToolAllowed(tool, profile, gateOptions);
  });
  const safety = classifyTool(response.tool);
  await emit(command, {
    ok: true,
    tool: name,
    safety,
    data: response.data,
    meta: { durationMs: Date.now() - started },
  }, name);
}

function addJsonInputOptions(command, plural = false) {
  if (plural) {
    return command
      .option("--ops <json>", "JSON array of {tool,args} operations")
      .option("--ops-file <path>", "Read operation array from a JSON file")
      .option("--stdin", "Read operation array from stdin");
  }
  return command
    .option("--args <json>", "Tool arguments as a JSON object")
    .option("--args-file <path>", "Read tool arguments from a JSON file")
    .option("--stdin", "Read tool arguments from stdin");
}

function addActionOptions(command) {
  return command
    .option("--perform-action", "Allow a tool not annotated read-only", false)
    .option("--allow-destructive", "Second gate for tools annotated destructive", false);
}

function buildProgram() {
  const program = new Command();
  program
    .name("affine-cli")
    .description("Agent-optimized CLI for AFFiNE, powered on demand by affine-mcp-server")
    .version(version)
    .option("--config <path>", "CLI profile configuration", defaultConfigPath())
    .option("--profile <id>", "Profile ID")
    .option("--pretty", "Pretty-print JSON", false)
    .option("--result-mode <mode>", "auto|inline|file", "auto")
    .option("--inline-max-bytes <n>", "Inline output byte limit", "16000")
    .option("--tmp-dir <path>", "Large-result directory")
    .option("--out <path>", "Write full JSON result to a specific 0600 file")
    .configureOutput({ writeErr: () => {} })
    .exitOverride();

  const profile = program.command("profile").description("Manage secure AFFiNE profiles");

  profile.command("list").description("List configured profiles").action(async (_opts, command) => {
    const configPath = commandOptions(command).config || defaultConfigPath();
    const config = await loadConfig(configPath);
    await emit(command, {
      ok: true,
      configPath,
      defaultProfile: config.defaultProfile,
      profiles: Object.values(config.profiles).map(redactProfile),
    }, "profiles");
  });

  profile.command("show").description("Show one redacted profile")
    .option("--id <id>", "Profile ID")
    .action(async (options, command) => {
      const configPath = commandOptions(command).config || defaultConfigPath();
      const config = await loadConfig(configPath);
      const id = options.id || commandOptions(command).profile || config.defaultProfile;
      const selected = id ? config.profiles[id] : null;
      if (!selected) throw new CliError(`Profile '${id || "(default)"}' was not found.`, { code: "PROFILE_NOT_FOUND", exitCode: EXIT.CONFIG });
      await emit(command, { ok: true, default: config.defaultProfile === id, profile: redactProfile(selected) }, `profile-${id}`);
    });

  profile.command("import-mcp").description("Migrate the existing affine-mcp/Codex MCP configuration")
    .option("--id <id>", "Destination profile ID", "default")
    .option("--source <path>", "Legacy affine-mcp config path", defaultMcpConfigPath())
    .option("--remove-source", "Remove the legacy credential file after successful keychain migration", false)
    .option("--perform-action", "Confirm removal of the legacy source file", false)
    .action(async (options, command) => {
      if (options.removeSource && !options.performAction) {
        throw new CliError("--remove-source requires --perform-action.", { code: "ACTION_GATED", exitCode: EXIT.GATED });
      }
      const configPath = commandOptions(command).config || defaultConfigPath();
      const imported = await importMcpProfile({
        id: options.id,
        sourcePath: options.source,
        configPath,
        removeSource: options.removeSource,
      });
      await emit(command, { ok: true, migrated: true, profile: imported }, `profile-${options.id}`);
    });

  profile.command("add").description("Add a profile; read the token from stdin")
    .requiredOption("--id <id>", "Profile ID")
    .requiredOption("--base-url <url>", "AFFiNE base URL")
    .option("--workspace <id>", "Default workspace ID")
    .option("--token-stdin", "Read token from stdin", false)
    .option("--set-default", "Set as default profile", false)
    .action(async (options, command) => {
      if (!options.tokenStdin) throw new CliError("Use --token-stdin so credentials do not enter shell history.", { code: "TOKEN_STDIN_REQUIRED", exitCode: EXIT.CONFIG });
      const token = (await readStdin()).trim();
      const configPath = commandOptions(command).config || defaultConfigPath();
      const added = await addProfile({ ...options, token, configPath, workspaceId: options.workspace });
      await emit(command, { ok: true, profile: added }, `profile-${options.id}`);
    });

  profile.command("test").description("Verify authentication with a read-only workspace list")
    .action(async (_options, command) => executeTool(command, "list_workspaces", {}));

  const tools = program.command("tools").description("Discover the upstream AFFiNE tool catalog");
  tools.command("list").description("List available tools with compact safety metadata")
    .option("--query <text>", "Filter names and descriptions")
    .option("--full", "Include input schemas", false)
    .action(async (options, command) => {
      const { profile } = await runtime(command);
      const query = String(options.query || "").toLowerCase();
      let catalog = await listTools(profile);
      if (query) catalog = catalog.filter((tool) => `${tool.name} ${tool.description || ""}`.toLowerCase().includes(query));
      const data = catalog.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        safety: classifyTool(tool),
        ...(options.full ? { inputSchema: tool.inputSchema } : {}),
      }));
      await emit(command, { ok: true, count: data.length, tools: data }, "tools");
    });

  tools.command("describe <name>").description("Show one tool's full schema and annotations")
    .action(async (name, _options, command) => {
      const { profile } = await runtime(command);
      const catalog = await listTools(profile);
      const tool = catalog.find((item) => item.name === name);
      if (!tool) throw new CliError(`Unknown AFFiNE tool '${name}'.`, { code: "TOOL_NOT_FOUND", exitCode: EXIT.USAGE });
      await emit(command, { ok: true, tool: { ...tool, safety: classifyTool(tool) } }, `tool-${name}`);
    });

  const invoke = addActionOptions(addJsonInputOptions(program.command("invoke <tool>").description("Invoke any AFFiNE tool")));
  invoke.action(async (tool, options, command) => {
    const args = await readPayload(options);
    await executeTool(command, tool, args, options);
  });

  const batch = addActionOptions(addJsonInputOptions(program.command("batch").description("Run several tools through one on-demand MCP session"), true));
  batch.action(async (options, command) => {
    const operations = await readPayload(options, { plural: true });
    if (!Array.isArray(operations) || operations.length === 0) throw new CliError("Batch input must be a non-empty JSON array.", { code: "INVALID_BATCH", exitCode: EXIT.USAGE });
    const { profile } = await runtime(command);
    const started = Date.now();
    const results = await invokeBatch(profile, operations, (tool) => assertToolAllowed(tool, profile, options));
    await emit(command, { ok: true, count: results.length, results, meta: { durationMs: Date.now() - started } }, "batch");
  });

  const workspace = program.command("workspace").description("Common workspace operations");
  workspace.command("list").description("List accessible workspaces")
    .action(async (_options, command) => executeTool(command, "list_workspaces", {}));

  const doc = program.command("doc").description("Common document operations");
  doc.command("search").description("Search document titles")
    .requiredOption("--workspace <id>", "Workspace ID")
    .requiredOption("--query <text>", "Title query")
    .option("--limit <n>", "Maximum results", "10")
    .action(async (options, command) => executeTool(command, "search_docs", {
      workspaceId: options.workspace,
      query: options.query,
      limit: Number(options.limit),
    }));

  doc.command("read").description("Read document blocks and text")
    .requiredOption("--workspace <id>", "Workspace ID")
    .requiredOption("--doc <id>", "Document ID")
    .option("--markdown", "Include rendered Markdown", false)
    .action(async (options, command) => executeTool(command, "read_doc", {
      workspaceId: options.workspace,
      docId: options.doc,
      includeMarkdown: !!options.markdown,
    }));

  doc.command("export").description("Export one document as Markdown")
    .requiredOption("--workspace <id>", "Workspace ID")
    .requiredOption("--doc <id>", "Document ID")
    .action(async (options, command) => executeTool(command, "export_doc_markdown", {
      workspaceId: options.workspace,
      docId: options.doc,
    }));

  const skill = program.command("skill").description("Locate the bundled agent skill");
  skill.command("path").description("Print the bundled affine-cli skill path")
    .action(async (_options, command) => {
      const packageJson = require.resolve("../package.json");
      const skillPath = path.join(path.dirname(packageJson), "skills", "affine-cli");
      await emit(command, { ok: true, path: skillPath }, "skill-path");
    });

  return program;
}

export async function main(argv = process.argv) {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError && ["commander.helpDisplayed", "commander.version"].includes(error.code)) return;
    const normalized = error instanceof CommanderError
      ? new CliError(error.message, { code: "USAGE_ERROR", exitCode: EXIT.USAGE })
      : error;
    process.stderr.write(`${JSON.stringify(errorEnvelope(normalized))}\n`);
    process.exitCode = exitCodeFor(normalized);
  }
}
