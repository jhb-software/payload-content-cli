import { describe, it, expect, vi } from "vitest";
import { parseSelect } from "../select.js";

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
    it("exits on invalid JSON", () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      const mockError = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => parseSelect("{invalid}")).toThrow("process.exit");
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockError).toHaveBeenCalledWith("Error: --select must be a valid JSON object.");

      mockExit.mockRestore();
      mockError.mockRestore();
    });

    it("exits on non-boolean/non-object values", () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      const mockError = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => parseSelect('{"title":"yes"}')).toThrow("process.exit");
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
      mockError.mockRestore();
    });

    it("exits on comma-separated input", () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      const mockError = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => parseSelect("title,slug")).toThrow("process.exit");
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
      mockError.mockRestore();
    });
  });
});
