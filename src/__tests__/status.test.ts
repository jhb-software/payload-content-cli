import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { contentHash, saveManifest } from "../manifest.js";
import { status } from "../status.js";

describe("status scan with a missing content directory", () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "pcc-status-"));
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it("does not warn when only collections were pulled (no globals directory)", async () => {
    // Simulate a pull that fetched collections but not globals.
    const collectionFile = path.join(outputDir, "collections", "posts", "a.json");
    await fs.mkdir(path.dirname(collectionFile), { recursive: true });
    const content = JSON.stringify({ title: "A" }, null, 2) + "\n";
    await fs.writeFile(collectionFile, content);

    await saveManifest(outputDir, {
      payloadUrl: "http://localhost:3000",
      documents: {
        "collections/posts/a.json": { hash: contentHash(content), updatedAt: null },
      },
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await status(loadConfig({ outputDir }));

      expect(result).not.toBeNull();
      expect(result!.modified).toHaveLength(0);
      expect(result!.added).toHaveLength(0);
      expect(result!.deleted).toHaveLength(0);
      // The absent globals directory is normal and must not produce a warning.
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
