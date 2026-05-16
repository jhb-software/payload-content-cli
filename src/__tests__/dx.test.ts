import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig, requireRemoteConfig } from "../config.js";
import { PayloadClient, PayloadApiError } from "../client.js";

describe("agent onboarding DX", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("requireRemoteConfig reports all missing env vars at once", () => {
    it("lists both PAYLOAD_URL and PAYLOAD_API_KEY when both missing", () => {
      const config = loadConfig();
      config.payloadUrl = undefined;
      config.apiKey = undefined;

      expect(() => requireRemoteConfig(config)).toThrow(
        "Missing required env vars: PAYLOAD_URL, PAYLOAD_API_KEY",
      );
    });

    it("lists only PAYLOAD_URL when apiKey is present", () => {
      const config = loadConfig({ apiKey: "key" });
      config.payloadUrl = undefined;

      const err = getError(() => requireRemoteConfig(config));
      expect(err.message).toContain("PAYLOAD_URL");
      expect(err.message).not.toContain("PAYLOAD_API_KEY");
    });

    it("lists only PAYLOAD_API_KEY when payloadUrl is present", () => {
      const config = loadConfig({ payloadUrl: "http://localhost:3000" });
      config.apiKey = undefined;

      const err = getError(() => requireRemoteConfig(config));
      expect(err.message).toContain("PAYLOAD_API_KEY");
      expect(err.message).not.toContain("PAYLOAD_URL");
    });
  });

  describe("getMe error messages", () => {
    it("mentions PAYLOAD_AUTH_COLLECTION when collection returns 404", async () => {
      const client = new PayloadClient({
        payloadUrl: "http://localhost:3000",
        apiKey: "test-key",
        authCollection: "wrong-collection",
        outputDir: "content",
      });

      vi.spyOn(client as unknown as { request: () => void }, "request").mockRejectedValue(
        new PayloadApiError(404, "/wrong-collection/me", "Not Found"),
      );

      await expect(client.getMe("wrong-collection")).rejects.toThrow(/PAYLOAD_AUTH_COLLECTION/);
      await expect(client.getMe("wrong-collection")).rejects.toThrow(/wrong-collection/);
    });

    it("does not swallow non-404 errors", async () => {
      const client = new PayloadClient({
        payloadUrl: "http://localhost:3000",
        apiKey: "test-key",
        authCollection: "users",
        outputDir: "content",
      });

      vi.spyOn(client as unknown as { request: () => void }, "request").mockRejectedValue(
        new PayloadApiError(403, "/users/me", "Forbidden"),
      );

      await expect(client.getMe("users")).rejects.toThrow(PayloadApiError);
    });
  });

  describe("help output includes env var documentation", () => {
    it("lists all env vars in --help output", async () => {
      const { execFileSync } = await import("node:child_process");
      const help = execFileSync("node", ["dist/cli.js", "--help"], {
        encoding: "utf-8",
      });

      expect(help).toContain("PAYLOAD_URL");
      expect(help).toContain("PAYLOAD_API_KEY");
      expect(help).toContain("PAYLOAD_AUTH_COLLECTION");
      expect(help).toContain("PAYLOAD_OUTPUT_DIR");
    });
  });
});

function getError(fn: () => void): Error {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error("Expected function to throw");
}
