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
  console.error(
    `Error: --select values must be booleans or nested objects, got ${typeof obj} at "${path}".`,
  );
  process.exit(1);
}

export function parseSelect(raw: string): SelectType {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    console.error("Error: --select must be a valid JSON object.");
    process.exit(1);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.error("Error: --select must be a valid JSON object.");
    process.exit(1);
  }
  validateSelect(parsed, "");
  return parsed as SelectType;
}
