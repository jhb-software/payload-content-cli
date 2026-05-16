import { describe, it, expect } from "vitest";
import { parseContentPath } from "../push.js";

describe("parseContentPath", () => {
  const outputDir = "/content";

  describe("collection documents", () => {
    it("parses collections/<slug>/<id>.json", () => {
      const result = parseContentPath("/content/collections/posts/abc123.json", outputDir);
      expect(result).toEqual({
        type: "collection",
        collection: "posts",
        id: "abc123",
        filePath: "/content/collections/posts/abc123.json",
      });
    });

    it("handles MongoDB ObjectId-style IDs", () => {
      const result = parseContentPath(
        "/content/collections/posts/69b70de86edb378b1801b35d.json",
        outputDir,
      );
      expect(result).toEqual({
        type: "collection",
        collection: "posts",
        id: "69b70de86edb378b1801b35d",
        filePath: "/content/collections/posts/69b70de86edb378b1801b35d.json",
      });
    });

    it("ignores _schema.json inside collection folders", () => {
      expect(parseContentPath("/content/collections/posts/_schema.json", outputDir)).toBeNull();
    });

    it("ignores _jsonschema.json inside collection folders", () => {
      expect(parseContentPath("/content/collections/posts/_jsonschema.json", outputDir)).toBeNull();
    });

    it("handles hyphenated collection slugs", () => {
      const result = parseContentPath("/content/collections/blog-posts/123.json", outputDir);
      expect(result?.collection).toBe("blog-posts");
    });
  });

  describe("globals (folder structure)", () => {
    it("parses globals/<slug>/<slug>.json", () => {
      const result = parseContentPath(
        "/content/globals/site-settings/site-settings.json",
        outputDir,
      );
      expect(result).toEqual({
        type: "global",
        collection: "site-settings",
        filePath: "/content/globals/site-settings/site-settings.json",
      });
    });

    it("ignores _schema.json inside global folders", () => {
      const result = parseContentPath("/content/globals/site-settings/_schema.json", outputDir);
      expect(result).toBeNull();
    });

    it("ignores _jsonschema.json inside global folders", () => {
      const result = parseContentPath("/content/globals/site-settings/_jsonschema.json", outputDir);
      expect(result).toBeNull();
    });

    it("ignores non-matching filenames in global folders", () => {
      const result = parseContentPath("/content/globals/site-settings/other-file.json", outputDir);
      expect(result).toBeNull();
    });
  });

  describe("globals (legacy flat structure)", () => {
    it("parses globals/<slug>.json", () => {
      const result = parseContentPath("/content/globals/site-settings.json", outputDir);
      expect(result).toEqual({
        type: "global",
        collection: "site-settings",
        filePath: "/content/globals/site-settings.json",
      });
    });

    it("ignores _-prefixed files in flat globals", () => {
      const result = parseContentPath("/content/globals/_localization.json", outputDir);
      expect(result).toBeNull();
    });
  });

  describe("ignored paths", () => {
    it("returns null for .manifest.json", () => {
      expect(parseContentPath("/content/.manifest.json", outputDir)).toBeNull();
    });

    it("returns null for _localization.json at root", () => {
      expect(parseContentPath("/content/_localization.json", outputDir)).toBeNull();
    });

    it("returns null for paths outside known directories", () => {
      expect(parseContentPath("/content/random/file.json", outputDir)).toBeNull();
    });

    it("returns null for deeply nested unknown paths", () => {
      expect(parseContentPath("/content/a/b/c/d.json", outputDir)).toBeNull();
    });
  });
});
