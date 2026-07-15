import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readDocument } from "../io.js";

describe("readDocument", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexical-io-"));
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("includes the original parse error detail for invalid JSON", async () => {
    const file = path.join(dir, "broken.json");
    await fs.writeFile(file, '{"title": "unterminated');

    await expect(readDocument(file)).rejects.toThrow(
      new RegExp(`Failed to parse JSON from .*broken\\.json: .+`),
    );
  });
});
