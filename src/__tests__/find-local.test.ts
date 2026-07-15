import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { find, toLocalWhere } from "../find.js";
import { CliError } from "../errors.js";

describe("toLocalWhere", () => {
  it("maps equals and like/contains operators", () => {
    expect(toLocalWhere({ slug: { equals: "hello" } })).toEqual({
      slug: { op: "equals", value: "hello" },
    });
    expect(toLocalWhere({ title: { like: "world" } })).toEqual({
      title: { op: "contains", value: "world" },
    });
    expect(toLocalWhere({ title: { contains: "world" } })).toEqual({
      title: { op: "contains", value: "world" },
    });
  });

  it("treats bare values as contains", () => {
    expect(toLocalWhere({ title: "hello" })).toEqual({
      title: { op: "contains", value: "hello" },
    });
  });

  it("rejects unsupported operators instead of silently inverting them", () => {
    expect(() => toLocalWhere({ status: { not_equals: "draft" } })).toThrow(CliError);
    expect(() => toLocalWhere({ status: { not_equals: "draft" } })).toThrow(/not_equals/);
  });
});

describe("find --local matching", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "find-local-"));
    const postsDir = path.join(dir, "collections", "posts");
    await fs.mkdir(postsDir, { recursive: true });
    await fs.writeFile(
      path.join(postsDir, "a.json"),
      JSON.stringify({ id: "a", slug: "hello", title: "Hello World" }),
    );
    await fs.writeFile(
      path.join(postsDir, "b.json"),
      JSON.stringify({ id: "b", slug: "hello-again", title: "Other" }),
    );
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const config = { authCollection: "api-keys", outputDir: "" };

  it("equals matches exactly, not by substring", async () => {
    const results = await find(
      { ...config, outputDir: dir },
      { collection: "posts", where: { slug: { op: "equals", value: "hello" } } },
    );
    expect(results.map((r) => r.filePath)).toEqual(["collections/posts/a.json"]);
  });

  it("contains matches case-insensitive substrings", async () => {
    const results = await find(
      { ...config, outputDir: dir },
      { collection: "posts", where: { slug: { op: "contains", value: "HELLO" } } },
    );
    expect(results).toHaveLength(2);
  });
});
