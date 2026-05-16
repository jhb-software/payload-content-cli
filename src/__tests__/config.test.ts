import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, requireRemoteConfig } from "../config.js";

// Prevent dotenv from loading the project's local .env, which would otherwise
// shadow `delete process.env.X` in tests that exercise the no-config path.
vi.mock("dotenv", () => ({
  default: { config: () => ({ parsed: {} }) },
}));

describe("loadConfig", () => {
  beforeEach(() => {
    vi.stubEnv("PAYLOAD_URL", "http://localhost:3939");
    vi.stubEnv("PAYLOAD_API_KEY", "test-key");
    vi.stubEnv("PAYLOAD_AUTH_COLLECTION", "users");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads all values from environment variables", () => {
    vi.stubEnv("PAYLOAD_URL", "http://env-url:3000");
    vi.stubEnv("PAYLOAD_API_KEY", "env-key");
    vi.stubEnv("PAYLOAD_AUTH_COLLECTION", "admins");

    const config = loadConfig();
    expect(config.payloadUrl).toBe("http://env-url:3000");
    expect(config.apiKey).toBe("env-key");
    expect(config.authCollection).toBe("admins");
    expect(config.outputDir).toBe("content");
  });

  it("overrides env vars with explicit parameters", () => {
    const config = loadConfig({
      payloadUrl: "http://override:4000",
      apiKey: "override-key",
      outputDir: "my-content",
    });
    expect(config.payloadUrl).toBe("http://override:4000");
    expect(config.apiKey).toBe("override-key");
    expect(config.outputDir).toBe("my-content");
  });

  it("defaults authCollection to 'api-keys'", () => {
    vi.stubEnv("PAYLOAD_AUTH_COLLECTION", "");
    delete process.env.PAYLOAD_AUTH_COLLECTION;

    const config = loadConfig();
    expect(config.authCollection).toBe("api-keys");
  });

  it("defaults outputDir to 'content'", () => {
    const config = loadConfig();
    expect(config.outputDir).toBe("content");
  });

  it("allows payloadUrl and apiKey to be undefined for offline commands", () => {
    delete process.env.PAYLOAD_URL;
    delete process.env.PAYLOAD_API_KEY;

    const config = loadConfig();
    expect(config.payloadUrl).toBeUndefined();
    expect(config.apiKey).toBeUndefined();
  });

  it("rejects invalid URLs", () => {
    expect(() => loadConfig({ payloadUrl: "not-a-url" })).toThrow();
  });
});

describe("requireRemoteConfig", () => {
  it("throws a helpful message when payloadUrl is missing", () => {
    const config = loadConfig({ apiKey: "key" });
    config.payloadUrl = undefined;

    expect(() => requireRemoteConfig(config)).toThrow(
      "Missing required env vars: PAYLOAD_URL",
    );
  });

  it("throws a helpful message when apiKey is missing", () => {
    const config = loadConfig({ payloadUrl: "http://localhost:3939" });
    config.apiKey = undefined;

    expect(() => requireRemoteConfig(config)).toThrow(
      "Missing required env vars: PAYLOAD_API_KEY",
    );
  });

  it("narrows the type when both are present", () => {
    const config = loadConfig({
      payloadUrl: "http://localhost:3939",
      apiKey: "test-key",
    });

    requireRemoteConfig(config);
    // After assertion, TypeScript knows these are strings
    const url: string = config.payloadUrl;
    const key: string = config.apiKey;
    expect(url).toBe("http://localhost:3939");
    expect(key).toBe("test-key");
  });
});
