import { describe, it, expect } from "vitest";
import { extractEndpointMeta } from "../index.js";

describe("extractEndpointMeta", () => {
  it("returns empty object when custom is undefined", () => {
    expect(extractEndpointMeta(undefined)).toEqual({});
  });

  it("returns empty object when custom is null", () => {
    expect(extractEndpointMeta(null)).toEqual({});
  });

  it("returns empty object when custom is a non-object", () => {
    expect(extractEndpointMeta("string")).toEqual({});
    expect(extractEndpointMeta(42)).toEqual({});
  });

  it("returns empty object when custom has no recognized keys", () => {
    expect(extractEndpointMeta({ unrelated: true })).toEqual({});
  });

  it("extracts description", () => {
    expect(extractEndpointMeta({ description: "Get stats" })).toEqual({
      description: "Get stats",
    });
  });

  it("ignores non-string description", () => {
    expect(extractEndpointMeta({ description: 123 })).toEqual({});
  });

  it("extracts schema with query", () => {
    const custom = { schema: { query: { locale: "string" } } };
    expect(extractEndpointMeta(custom)).toEqual({
      schema: { query: { locale: "string" } },
    });
  });

  it("extracts schema with body", () => {
    const custom = { schema: { body: { title: "string" } } };
    expect(extractEndpointMeta(custom)).toEqual({
      schema: { body: { title: "string" } },
    });
  });

  it("extracts schema with response", () => {
    const custom = { schema: { response: { count: "number" } } };
    expect(extractEndpointMeta(custom)).toEqual({
      schema: { response: { count: "number" } },
    });
  });

  it("extracts all schema fields together", () => {
    const custom = {
      description: "Publish drafts",
      schema: {
        query: { locale: "string" },
        body: { dryRun: "boolean" },
        response: { published: "number" },
      },
    };
    expect(extractEndpointMeta(custom)).toEqual(custom);
  });

  it("ignores non-object schema", () => {
    expect(extractEndpointMeta({ schema: "not-object" })).toEqual({});
  });

  it("ignores non-object schema sub-fields", () => {
    expect(extractEndpointMeta({ schema: { query: "bad", body: 42 } })).toEqual({});
  });

  it("ignores extra keys in custom", () => {
    const result = extractEndpointMeta({
      description: "Test",
      somethingElse: true,
    });
    expect(result).toEqual({ description: "Test" });
    expect(result).not.toHaveProperty("somethingElse");
  });
});
