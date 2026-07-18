export const EXIT = Object.freeze({
  OK: 0,
  USAGE: 2,
  CONFIG: 3,
  GATED: 4,
  UPSTREAM: 5,
});

export class CliError extends Error {
  constructor(message, { code = "CLI_ERROR", exitCode = EXIT.USAGE, details, hint } = {}) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
    this.hint = hint;
  }
}

function cleanDetails(details) {
  if (!details || typeof details !== "object") return undefined;
  const out = {};
  for (const [key, value] of Object.entries(details)) {
    if (/token|password|cookie|authorization|secret/i.test(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export function errorEnvelope(error) {
  const known = error instanceof CliError;
  return {
    ok: false,
    error: {
      code: known ? error.code : "UPSTREAM_ERROR",
      message: String(error?.message || error || "Unknown error"),
      ...(known && error.hint ? { hint: error.hint } : {}),
      ...(known && cleanDetails(error.details) ? { details: cleanDetails(error.details) } : {}),
    },
  };
}

export function exitCodeFor(error) {
  return error instanceof CliError ? error.exitCode : EXIT.UPSTREAM;
}
