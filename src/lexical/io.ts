import * as fs from "node:fs/promises";

export async function readDocument(
  filePath: string,
): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf-8");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse JSON from ${filePath}`);
  }
}

export async function writeDocument(
  filePath: string,
  doc: Record<string, unknown>,
): Promise<void> {
  const content = JSON.stringify(doc, null, 2) + "\n";
  await fs.writeFile(filePath, content);
}
