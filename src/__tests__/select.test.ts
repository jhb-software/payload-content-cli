import { describe, it, expect } from "vitest";
import { parseSelect } from "../select.js";
import { CliError } from "../errors.js";

describe("parseSelect", () => {
  describe("flat booleans", () => {
    it("parses include object", () => {
      expect(parseSelect('{"title":true,"slug":true}')).toEqual({
        title: true,
        slug: true,
      });
    });

    it("parses exclude object", () => {
      expect(parseSelect('{"content":false,"richText":false}')).toEqual({
        content: false,
        richText: false,
      });
    });

    it("allows mixed booleans", () => {
      expect(parseSelect('{"title":true,"content":false}')).toEqual({
        title: true,
        content: false,
      });
    });
  });

  describe("nested objects (group sub-fields)", () => {
    it("selects sub-fields of groups", () => {
      expect(parseSelect('{"meta":{"title":true}}')).toEqual({
        meta: { title: true },
      });
    });

    it("selects multiple sub-fields", () => {
      expect(parseSelect('{"meta":{"title":true,"description":false}}')).toEqual({
        meta: { title: true, description: false },
      });
    });

    it("mixes flat and nested", () => {
      expect(parseSelect('{"title":true,"meta":{"title":true}}')).toEqual({
        title: true,
        meta: { title: true },
      });
    });
  });

  describe("errors", () => {
    it("throws a CliError on invalid JSON", () => {
      expect(() => parseSelect("{invalid}")).toThrow(CliError);
      expect(() => parseSelect("{invalid}")).toThrow("--select must be a valid JSON object.");
    });

    it("throws a CliError on non-boolean/non-object values", () => {
      expect(() => parseSelect('{"title":"yes"}')).toThrow(CliError);
    });

    it("throws a CliError on comma-separated input", () => {
      expect(() => parseSelect("title,slug")).toThrow(CliError);
    });
  });
});
