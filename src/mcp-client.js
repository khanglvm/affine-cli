import path from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CliError, EXIT } from "./errors.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

function resolveServerBin() {
  const packageJson = require.resolve("affine-mcp-server/package.json");
  return path.join(path.dirname(packageJson), "bin", "affine-mcp");
}

function cleanEnv(extra) {
  return Object.fromEntries(Object.entries({ ...process.env, ...extra }).filter(([, value]) => value !== undefined && value !== null));
}

export function decodeToolResult(result) {
  if (result?.isError) {
    const message = result.content?.map((item) => item?.text).filter(Boolean).join("\n") || "AFFiNE tool returned an error";
    throw new CliError(message, { code: "TOOL_CALL_FAILED", exitCode: EXIT.UPSTREAM });
  }
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = (result?.content || []).filter((item) => item?.type === "text").map((item) => item.text).join("\n");
  if (!text) return result?.content || null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function withMcpClient(profile, action) {
  const diagnostics = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolveServerBin()],
    env: cleanEnv({
      AFFINE_BASE_URL: profile.baseUrl,
      AFFINE_API_TOKEN: profile.token,
      AFFINE_WORKSPACE_ID: profile.workspaceId || undefined,
      AFFINE_TOOL_PROFILE: profile.toolProfile || "full",
      AFFINE_DISABLED_TOOLS: (profile.disabledTools || []).join(",") || undefined,
      AFFINE_DISABLED_GROUPS: (profile.disabledGroups || []).join(",") || undefined,
      AFFINE_MCP_AUTH_MODE: "bearer",
    }),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    if (diagnostics.join("").length < 8_000) diagnostics.push(String(chunk));
  });

  const client = new Client({ name: "affine-cli", version }, { capabilities: {} });
  try {
    await client.connect(transport);
    return await action(client);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(error?.message || "Failed to communicate with affine-mcp-server.", {
      code: "MCP_RUNTIME_ERROR",
      exitCode: EXIT.UPSTREAM,
      details: diagnostics.length ? { diagnostics: diagnostics.join("").slice(-2_000) } : undefined,
    });
  } finally {
    await transport.close().catch(() => {});
  }
}

export async function listTools(profile) {
  return withMcpClient(profile, async (client) => {
    const response = await client.listTools();
    return response.tools || [];
  });
}

export async function callTool(profile, name, args) {
  return withMcpClient(profile, async (client) => {
    const result = await client.callTool({ name, arguments: args || {} });
    return decodeToolResult(result);
  });
}

export async function invokeTool(profile, name, args, beforeCall) {
  return withMcpClient(profile, async (client) => {
    const tools = (await client.listTools()).tools || [];
    const tool = tools.find((item) => item.name === name);
    if (!tool) {
      throw new CliError(`Unknown AFFiNE tool '${name}'.`, {
        code: "TOOL_NOT_FOUND",
        exitCode: EXIT.USAGE,
        details: { tool: name },
        hint: "Run 'affine-cli tools list' to discover available tools.",
      });
    }
    if (beforeCall) await beforeCall(tool);
    const result = await client.callTool({ name, arguments: args || {} });
    return { tool, data: decodeToolResult(result) };
  });
}

export async function preflightBatchOperations(tools, operations, beforeCall) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const prepared = [];
  for (const [index, operation] of operations.entries()) {
    const name = operation?.tool;
    const tool = byName.get(name);
    if (!tool) {
      throw new CliError(`Unknown AFFiNE tool '${name}' at batch index ${index}.`, {
        code: "TOOL_NOT_FOUND",
        exitCode: EXIT.USAGE,
        details: { tool: name, index },
      });
    }
    if (beforeCall) await beforeCall(tool, operation, index);
    prepared.push({ index, name, args: operation.args || {} });
  }
  return prepared;
}

export async function invokeBatch(profile, operations, beforeCall) {
  return withMcpClient(profile, async (client) => {
    const tools = (await client.listTools()).tools || [];
    // Validate the complete batch before the first API call. This prevents a
    // later unknown, disabled, or ungated operation from causing hidden
    // partial mutations.
    const prepared = await preflightBatchOperations(tools, operations, beforeCall);
    const results = [];
    for (const { index, name, args } of prepared) {
      const result = await client.callTool({ name, arguments: args });
      results.push({ index, tool: name, data: decodeToolResult(result) });
    }
    return results;
  });
}
