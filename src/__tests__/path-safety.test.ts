import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  assertInsideDirectory,
  assertSafePathSegment,
  safeJoinPath,
} from "../path-safety.js";

describe("assertSafePathSegment", () => {
  it("allows ordinary Payload slugs and IDs", () => {
    expect(() => assertSafePathSegment("blog-posts", "slug")).not.toThrow();
    expect(() =>
      assertSafePathSegment("69b70de86edb378b1801b35d", "id"),
    ).not.toThrow();
  });

  it.each([
    "",
    ".",
    "..",
    "../secret",
    "nested/path",
    "nested\\path",
    "CON.json",
  ])("rejects unsafe path segment %s", (segment) => {
    expect(() => assertSafePathSegment(segment, "value")).toThrow(
      "Unsafe value",
    );
  });
});

describe("safeJoinPath", () => {
  it("joins safe path segments under the base directory", () => {
    const base = path.resolve("content");
    expect(safeJoinPath(base, "collections", "posts")).toBe(
      path.join(base, "collections", "posts"),
    );
  });

  it("rejects traversal segments before joining", () => {
    const base = path.resolve("content");
    expect(() => safeJoinPath(base, "collections", "../secret")).toThrow(
      "Unsafe path segment",
    );
  });
});

describe("assertInsideDirectory", () => {
  it("allows paths inside the base directory", () => {
    const base = path.resolve("content");
    expect(() =>
      assertInsideDirectory(base, path.join(base, "collections/posts/1.json")),
    ).not.toThrow();
  });

  it("rejects paths outside the base directory", () => {
    const base = path.resolve("content");
    expect(() =>
      assertInsideDirectory(base, path.resolve("outside.json")),
    ).toThrow("Refusing to write outside");
  });
});
