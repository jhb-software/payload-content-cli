import { CliError } from "./errors.js";

export type SelectIncludeType = {
  [k: string]: SelectIncludeType | true;
};

export type SelectExcludeType = {
  [k: string]: false | SelectExcludeType;
};

export type SelectType = SelectExcludeType | SelectIncludeType;

function validateSelect(obj: unknown, path: string): void {
  if (typeof obj === "boolean") return;
  if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      validateSelect(value, path ? `${path}.${key}` : key);
    }
    return;
  }
  throw new CliError(
    `--select values must be booleans or nested objects, got ${typeof obj} at "${path}".`,
  );
}

export function parseSelect(raw: string): SelectType {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new CliError("--select must be a valid JSON object.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliError("--select must be a valid JSON object.");
  }
  validateSelect(parsed, "");
  return parsed as SelectType;
}
