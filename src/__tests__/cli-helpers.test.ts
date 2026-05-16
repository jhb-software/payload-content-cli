import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseCommonOpts,
  parsePaginationOpts,
  parsePublishOpts,
  parseJson,
  wrapAction,
} from "../cli-helpers.js";

describe("parseCommonOpts", () => {
  it("parses depth as a number", () => {
    const result = parseCommonOpts({ depth: "3" });
    expect(result.depth).toBe(3);
  });

  it("returns undefined for missing depth", () => {
    const result = parseCommonOpts({});
    expect(result.depth).toBeUndefined();
  });

  it("passes through string options", () => {
    const result = parseCommonOpts({
      locale: "en",
      fallbackLocale: "de",
    });
    expect(result.locale).toBe("en");
    expect(result.fallbackLocale).toBe("de");
  });

  it("passes through boolean options", () => {
    const result = parseCommonOpts({ draft: true, trash: true });
    expect(result.draft).toBe(true);
    expect(result.trash).toBe(true);
  });

  it("parses select from JSON string", () => {
    const result = parseCommonOpts({ select: '{"title": true}' });
    expect(result.select).toEqual({ title: true });
  });

  it("parses populate from JSON string", () => {
    const result = parseCommonOpts({ populate: '{"author": {}}' });
    expect(result.populate).toEqual({ author: {} });
  });

  it("parses joins from JSON string", () => {
    const result = parseCommonOpts({ joins: '{"posts": {}}' });
    expect(result.joins).toEqual({ posts: {} });
  });

  it("handles all options together", () => {
    const result = parseCommonOpts({
      depth: "2",
      locale: "fr",
      fallbackLocale: "en",
      draft: true,
      trash: true,
      select: '{"title": true}',
      populate: '{"author": {}}',
      joins: '{"tags": {}}',
    });
    expect(result).toEqual({
      depth: 2,
      locale: "fr",
      fallbackLocale: "en",
      draft: true,
      trash: true,
      select: { title: true },
      populate: { author: {} },
      joins: { tags: {} },
    });
  });

  it("returns all undefined for empty opts", () => {
    const result = parseCommonOpts({});
    expect(result).toEqual({
      depth: undefined,
      locale: undefined,
      fallbackLocale: undefined,
      draft: undefined,
      select: undefined,
      populate: undefined,
      joins: undefined,
      trash: undefined,
    });
  });
});

describe("parsePaginationOpts", () => {
  it("parses limit and page as numbers", () => {
    const result = parsePaginationOpts({ limit: "10", page: "2" });
    expect(result.limit).toBe(10);
    expect(result.page).toBe(2);
  });

  it("passes through sort and pagination", () => {
    const result = parsePaginationOpts({
      sort: "-createdAt",
      pagination: false,
    });
    expect(result.sort).toBe("-createdAt");
    expect(result.pagination).toBe(false);
  });
});

describe("parsePublishOpts", () => {
  it("parses all publish options", () => {
    const result = parsePublishOpts({
      autosave: true,
      publishSpecificLocale: "en",
      publishAllLocales: true,
      unpublishAllLocales: false,
    });
    expect(result).toEqual({
      autosave: true,
      publishSpecificLocale: "en",
      publishAllLocales: true,
      unpublishAllLocales: false,
    });
  });
});

describe("parseJson", () => {
  it("parses valid JSON", () => {
    expect(parseJson('{"a": 1}', "--test")).toEqual({ a: 1 });
  });

  it("exits on invalid JSON", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const mockError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => parseJson("not json", "--where")).toThrow("process.exit");
    expect(mockError).toHaveBeenCalledWith(
      "Error: --where must be valid JSON.",
    );
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockError.mockRestore();
  });
});

describe("wrapAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the wrapped function", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = wrapAction(fn);
    await wrapped("a", "b");
    expect(fn).toHaveBeenCalledWith("a", "b");
  });

  it("catches errors and exits", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const mockError = vi.spyOn(console, "error").mockImplementation(() => {});

    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = wrapAction(fn);

    await expect(wrapped()).rejects.toThrow("process.exit");
    expect(mockError).toHaveBeenCalledWith("Error:", "boom");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
