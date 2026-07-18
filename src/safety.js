import { CliError, EXIT } from "./errors.js";

export function classifyTool(tool) {
  const annotations = tool?.annotations || {};
  return {
    readOnly: annotations.readOnlyHint === true,
    destructive: annotations.destructiveHint === true,
    idempotent: annotations.idempotentHint === true,
    openWorld: annotations.openWorldHint === true,
  };
}

export function assertToolAllowed(tool, profile, options = {}) {
  const name = String(tool?.name || "");
  const disabled = new Set(profile?.disabledTools || []);
  if (disabled.has(name)) {
    throw new CliError(`Tool '${name}' is disabled by this profile.`, {
      code: "TOOL_DISABLED",
      exitCode: EXIT.GATED,
      details: { tool: name },
      hint: "Use a different profile or explicitly update its disabled-tools policy.",
    });
  }

  const safety = classifyTool(tool);
  if (safety.readOnly) return safety;

  if (!options.performAction) {
    throw new CliError(`Tool '${name}' may mutate AFFiNE and is action-gated.`, {
      code: "ACTION_GATED",
      exitCode: EXIT.GATED,
      details: { tool: name, required: "--perform-action" },
      hint: "Read the target first, then rerun with --perform-action after confirming the exact mutation.",
    });
  }

  if (safety.destructive && !options.allowDestructive) {
    throw new CliError(`Tool '${name}' is destructive and requires a second explicit gate.`, {
      code: "DESTRUCTIVE_GATED",
      exitCode: EXIT.GATED,
      details: { tool: name, required: "--allow-destructive" },
      hint: "Prefer a reversible operation. If destruction is truly intended, add --allow-destructive.",
    });
  }

  return safety;
}
