import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  contentHash,
  loadManifest,
  saveManifest,
  siblingLocaleKeys,
  type Manifest,
} from "../manifest.js";

const TMP_DIR = path.resolve("tmp-manifest-test");

afterEach(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

describe("contentHash", () => {
  it("returns a 16-char hex string", () => {
    const hash = contentHash("hello world");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic", () => {
    expect(contentHash("test content")).toBe(contentHash("test content"));
  });

  it("produces different hashes for different inputs", () => {
    expect(contentHash("hello")).not.toBe(contentHash("world"));
  });

  it("is sensitive to whitespace changes", () => {
    expect(contentHash('{"a": 1}')).not.toBe(contentHash('{"a":1}'));
  });
});

describe("loadManifest / saveManifest", () => {
  it("returns null when no manifest exists", async () => {
    const result = await loadManifest("/nonexistent/path");
    expect(result).toBeNull();
  });

  it("round-trips a manifest through save and load", async () => {
    await fs.mkdir(TMP_DIR, { recursive: true });

    const manifest: Manifest = {
      payloadUrl: "http://localhost:3939",
      documents: {
        "collections/posts/abc123.json": {
          hash: "abcdef1234567890",
          updatedAt: "2026-03-15T10:00:00.000Z",
        },
        "globals/site-settings/site-settings.json": {
          hash: "1234567890abcdef",
          updatedAt: "2026-03-15T10:00:00.000Z",
        },
      },
    };

    await saveManifest(TMP_DIR, manifest);
    const loaded = await loadManifest(TMP_DIR);

    expect(loaded).toEqual(manifest);
  });
});

describe("siblingLocaleKeys", () => {
  const documents = {
    "collections/posts/123_en.json": { hash: "a".repeat(16), updatedAt: "t" },
    "collections/posts/123_de.json": { hash: "b".repeat(16), updatedAt: "t" },
    "collections/posts/123_fr.json": { hash: "c".repeat(16), updatedAt: "t" },
    "collections/posts/456_en.json": { hash: "d".repeat(16), updatedAt: "t" },
    "collections/pages/123_de.json": { hash: "e".repeat(16), updatedAt: "t" },
  };

  it("returns the other locale files of the same document", () => {
    expect(siblingLocaleKeys(documents, "collections/posts/123_en.json").sort()).toEqual([
      "collections/posts/123_de.json",
      "collections/posts/123_fr.json",
    ]);
  });

  it("excludes the key itself", () => {
    expect(siblingLocaleKeys(documents, "collections/posts/123_de.json")).not.toContain(
      "collections/posts/123_de.json",
    );
  });

  it("does not match a different document id with the same locale", () => {
    expect(siblingLocaleKeys(documents, "collections/posts/123_en.json")).not.toContain(
      "collections/posts/456_en.json",
    );
  });

  it("does not match the same id in a different collection", () => {
    expect(siblingLocaleKeys(documents, "collections/posts/123_en.json")).not.toContain(
      "collections/pages/123_de.json",
    );
  });

  it("returns nothing for a non-localized file", () => {
    const flat = {
      "collections/posts/123.json": { hash: "a".repeat(16), updatedAt: "t" },
      "collections/posts/123_en.json": { hash: "b".repeat(16), updatedAt: "t" },
    };
    expect(siblingLocaleKeys(flat, "collections/posts/123.json")).toEqual([]);
  });
});

describe("loadManifest / saveManifest (more)", () => {
  it("preserves all document entries", async () => {
    await fs.mkdir(TMP_DIR, { recursive: true });

    const manifest: Manifest = {
      payloadUrl: "http://localhost:3939",
      documents: {
        "collections/posts/1.json": {
          hash: "a".repeat(16),
          updatedAt: null,
        },
        "collections/posts/2.json": {
          hash: "b".repeat(16),
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };

    await saveManifest(TMP_DIR, manifest);
    const loaded = await loadManifest(TMP_DIR);

    expect(Object.keys(loaded!.documents)).toHaveLength(2);
    expect(loaded!.documents["collections/posts/1.json"].updatedAt).toBeNull();
    expect(loaded!.documents["collections/posts/2.json"].updatedAt).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });
});
