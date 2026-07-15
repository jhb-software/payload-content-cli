import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const CLI_ENTRY = path.resolve("src/cli.ts");
const TSX_BIN = path.resolve("node_modules/.bin/tsx");
const TMP = path.resolve(".tmp-lexical-cli-test");
const docPath = path.join(TMP, "doc.json");

function runCLI(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(TSX_BIN, [CLI_ENTRY, "lexical", ...args], {
    encoding: "utf-8",
    env: {
      PAYLOAD_URL: "http://payload.invalid",
      PAYLOAD_API_KEY: "fake-key-for-local-tests",
      ...process.env,
    },
  });
}

const originalDoc = {
  content: {
    root: {
      type: "root",
      version: 1,
      children: [
        {
          type: "paragraph",
          version: 1,
          children: [{ type: "text", text: "Hello world", version: 1 }],
        },
      ],
    },
  },
};

describe("lexical CLI (validation before write)", () => {
  beforeEach(async () => {
    await fs.mkdir(TMP, { recursive: true });
    await fs.writeFile(docPath, JSON.stringify(originalDoc, null, 2));
  });

  afterAll(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
  });

  it("refuses to write when the new node fails validation", async () => {
    const result = runCLI([
      "add",
      docPath,
      "--at",
      "0",
      "--position",
      "after",
      "--json",
      '{"type":"paragraph","children":[]}', // missing version
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Validation failed/);
    expect(result.stderr).toMatch(/missing "version"/);

    // File must be untouched
    const after = JSON.parse(await fs.readFile(docPath, "utf-8"));
    expect(after).toEqual(originalDoc);
  });

  it("writes and reports ok for a valid add", async () => {
    const result = runCLI([
      "add",
      docPath,
      "--at",
      "0",
      "--position",
      "after",
      "--paragraph",
      "New",
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/"ok":true/);

    const after = JSON.parse(await fs.readFile(docPath, "utf-8"));
    expect(after.content.root.children).toHaveLength(2);
  });

  it("link --from without --at exits 1 with a clear error", () => {
    const result = runCLI(["link", docPath, "--from", docPath]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--from requires --at/);
  });

  it("link without required options exits 1 with a clear error", () => {
    const result = runCLI(["link", docPath, "--search", "Hello"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--search, --relationTo, and --value are required/);
  });
});
