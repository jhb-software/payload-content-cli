import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadProfiles,
  saveProfiles,
  getProfile,
  setProfile,
  removeProfile,
  listProfiles,
  resolveProfile,
  maskApiKey,
  runCredentialCommand,
  materializeProfile,
} from "../profiles.js";

// Mock os.homedir to use a temp directory
let tmpDir: string;

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => tmpDir,
  };
});

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "profiles-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("loadProfiles", () => {
  it("returns empty object when no profiles file exists", async () => {
    const profiles = await loadProfiles();
    expect(profiles).toEqual({});
  });

  it("loads profiles from file", async () => {
    const dir = path.join(tmpDir, ".payload-content");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "profiles.json"),
      JSON.stringify({
        dev: { payloadUrl: "http://localhost:3000", apiKey: "dev-key" },
      }),
    );

    const profiles = await loadProfiles();
    expect(profiles.dev).toEqual({
      payloadUrl: "http://localhost:3000",
      apiKey: "dev-key",
    });
  });
});

describe("saveProfiles", () => {
  it("creates directory and file", async () => {
    await saveProfiles({
      prod: { payloadUrl: "https://example.com", apiKey: "prod-key" },
    });

    const raw = await fs.readFile(path.join(tmpDir, ".payload-content", "profiles.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.prod.payloadUrl).toBe("https://example.com");
  });

  it.skipIf(process.platform === "win32")(
    "writes file with mode 0600 and dir with mode 0700",
    async () => {
      await saveProfiles({
        prod: { payloadUrl: "https://example.com", apiKey: "prod-key" },
      });

      const dir = path.join(tmpDir, ".payload-content");
      const file = path.join(dir, "profiles.json");
      const dirStat = await fs.stat(dir);
      const fileStat = await fs.stat(file);
      // Mask off file-type bits, keep only permission bits
      expect(dirStat.mode & 0o777).toBe(0o700);
      expect(fileStat.mode & 0o777).toBe(0o600);
    },
  );

  it.skipIf(process.platform === "win32")(
    "tightens permissions on a pre-existing wide-open file",
    async () => {
      const dir = path.join(tmpDir, ".payload-content");
      await fs.mkdir(dir, { recursive: true, mode: 0o755 });
      const file = path.join(dir, "profiles.json");
      await fs.writeFile(file, "{}", { mode: 0o644 });

      await saveProfiles({
        dev: { payloadUrl: "http://localhost:3000" },
      });

      const dirStat = await fs.stat(dir);
      const fileStat = await fs.stat(file);
      expect(dirStat.mode & 0o777).toBe(0o700);
      expect(fileStat.mode & 0o777).toBe(0o600);
    },
  );
});

describe("setProfile / getProfile", () => {
  it("sets and retrieves a profile", async () => {
    await setProfile("staging", {
      payloadUrl: "https://staging.example.com",
      apiKey: "staging-key",
      authCollection: "admins",
    });

    const profile = await getProfile("staging");
    expect(profile).toEqual({
      payloadUrl: "https://staging.example.com",
      apiKey: "staging-key",
      authCollection: "admins",
    });
  });

  it("returns undefined for nonexistent profile", async () => {
    const profile = await getProfile("nope");
    expect(profile).toBeUndefined();
  });

  it("overwrites existing profile", async () => {
    await setProfile("dev", { payloadUrl: "http://localhost:3000" });
    await setProfile("dev", { payloadUrl: "http://localhost:4000" });

    const profile = await getProfile("dev");
    expect(profile?.payloadUrl).toBe("http://localhost:4000");
  });
});

describe("removeProfile", () => {
  it("removes an existing profile", async () => {
    await setProfile("dev", { payloadUrl: "http://localhost:3000" });
    const removed = await removeProfile("dev");
    expect(removed).toBe(true);

    const profile = await getProfile("dev");
    expect(profile).toBeUndefined();
  });

  it("returns false for nonexistent profile", async () => {
    const removed = await removeProfile("nope");
    expect(removed).toBe(false);
  });
});

describe("listProfiles", () => {
  it("returns empty array when no profiles", async () => {
    const names = await listProfiles();
    expect(names).toEqual([]);
  });

  it("returns profile names", async () => {
    await setProfile("dev", { payloadUrl: "http://localhost:3000" });
    await setProfile("prod", { payloadUrl: "https://example.com" });

    const names = await listProfiles();
    expect(names).toContain("dev");
    expect(names).toContain("prod");
  });
});

describe("resolveProfile", () => {
  it("returns the profile when it exists", async () => {
    await setProfile("dev", { payloadUrl: "http://localhost:3000" });
    const profile = await resolveProfile("dev");
    expect(profile.payloadUrl).toBe("http://localhost:3000");
  });

  it("throws with helpful message when profile not found", async () => {
    await expect(resolveProfile("nope")).rejects.toThrow('Profile "nope" not found.');
  });

  it("lists available profiles in error message", async () => {
    await setProfile("dev", { payloadUrl: "http://localhost:3000" });
    await expect(resolveProfile("nope")).rejects.toThrow("Available profiles: dev");
  });
});

describe("maskApiKey", () => {
  it("reveals last 4 chars for keys longer than 8", () => {
    expect(maskApiKey("abcdef1234567890")).toBe("************7890");
  });

  it("fully masks short keys (<= 8 chars) without revealing length", () => {
    expect(maskApiKey("abc")).toBe("****************");
    expect(maskApiKey("abcd1234")).toBe("****************");
  });

  it("output is fixed-width regardless of key length", () => {
    const short = maskApiKey("abc");
    const medium = maskApiKey("abcdef1234567890");
    const long = maskApiKey("a".repeat(100) + "wXyZ");
    expect(short.length).toBe(16);
    expect(medium.length).toBe(16);
    expect(long.length).toBe(16);
  });
});

describe("runCredentialCommand", () => {
  it.skipIf(process.platform === "win32")(
    "returns trimmed stdout of the helper command",
    async () => {
      const key = await runCredentialCommand("printf 'secret-key-123\\n'");
      expect(key).toBe("secret-key-123");
    },
  );

  it.skipIf(process.platform === "win32")("surfaces stderr when the command fails", async () => {
    await expect(runCredentialCommand("echo nope-from-stderr 1>&2 && exit 7")).rejects.toThrow(
      /nope-from-stderr/,
    );
  });

  it.skipIf(process.platform === "win32")(
    "rejects when the command produces empty output",
    async () => {
      await expect(runCredentialCommand("true")).rejects.toThrow(/empty output/);
    },
  );

  it.skipIf(process.platform === "win32")(
    "surfaces a Keychain-approval hint when the command times out",
    async () => {
      await expect(runCredentialCommand("sleep 5", { timeoutMs: 100 })).rejects.toThrow(
        /timed out after .*s.*Keychain access prompt/s,
      );
    },
  );
});

describe("profile schema", () => {
  it("rejects a profile with both apiKey and credentialCommand on disk", async () => {
    const dir = path.join(tmpDir, ".payload-content");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "profiles.json"),
      JSON.stringify({
        dev: { apiKey: "plain", credentialCommand: "echo other" },
      }),
    );
    await expect(loadProfiles()).rejects.toThrow(/cannot set both apiKey and credentialCommand/i);
  });
});

describe("materializeProfile", () => {
  it.skipIf(process.platform === "win32")(
    "populates apiKey from credentialCommand stdout",
    async () => {
      const materialized = await materializeProfile({
        payloadUrl: "https://example.com",
        credentialCommand: "printf 'from-helper\\n'",
      });
      expect(materialized.apiKey).toBe("from-helper");
      expect(materialized.credentialCommand).toBeUndefined();
    },
  );

  it("returns the profile unchanged when no credentialCommand is set", async () => {
    const profile = { payloadUrl: "https://example.com", apiKey: "plain" };
    const materialized = await materializeProfile(profile);
    expect(materialized).toEqual(profile);
  });
});

describe("loadConfig with profile", () => {
  // Test that config.ts properly merges profile values
  it("profile values are used as fallback", async () => {
    // Clear env vars to test profile fallback
    const origUrl = process.env.PAYLOAD_URL;
    const origKey = process.env.PAYLOAD_API_KEY;
    const origAuth = process.env.PAYLOAD_AUTH_COLLECTION;
    delete process.env.PAYLOAD_URL;
    delete process.env.PAYLOAD_API_KEY;
    delete process.env.PAYLOAD_AUTH_COLLECTION;

    try {
      const { loadConfig } = await import("../config.js");
      const config = loadConfig(undefined, {
        payloadUrl: "http://profile-url:3000",
        apiKey: "profile-key",
        authCollection: "profile-auth",
        outputDir: "profile-content",
      });

      expect(config.payloadUrl).toBe("http://profile-url:3000");
      expect(config.apiKey).toBe("profile-key");
      expect(config.authCollection).toBe("profile-auth");
      expect(config.outputDir).toBe("profile-content");
    } finally {
      if (origUrl) process.env.PAYLOAD_URL = origUrl;
      if (origKey) process.env.PAYLOAD_API_KEY = origKey;
      if (origAuth) process.env.PAYLOAD_AUTH_COLLECTION = origAuth;
    }
  });

  it("env vars override profile values", async () => {
    vi.stubEnv("PAYLOAD_URL", "http://env-url:3000");
    vi.stubEnv("PAYLOAD_API_KEY", "env-key");

    try {
      const { loadConfig } = await import("../config.js");
      const config = loadConfig(undefined, {
        payloadUrl: "http://profile-url:3000",
        apiKey: "profile-key",
      });

      expect(config.payloadUrl).toBe("http://env-url:3000");
      expect(config.apiKey).toBe("env-key");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("explicit overrides beat both env and profile", async () => {
    vi.stubEnv("PAYLOAD_URL", "http://env-url:3000");

    try {
      const { loadConfig } = await import("../config.js");
      const config = loadConfig(
        { payloadUrl: "http://override:3000" },
        { payloadUrl: "http://profile:3000" },
      );

      expect(config.payloadUrl).toBe("http://override:3000");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("warns once when a real env var shadows a profile value", async () => {
    vi.stubEnv("PAYLOAD_API_KEY", "env-key");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();

    try {
      const { loadConfig } = await import("../config.js");
      loadConfig(undefined, {
        payloadUrl: "http://profile:3000",
        apiKey: "profile-key",
      });
      loadConfig(undefined, {
        payloadUrl: "http://profile:3000",
        apiKey: "profile-key",
      });

      const apiKeyWarnings = warnSpy.mock.calls.filter((call) =>
        String(call[0]).includes("PAYLOAD_API_KEY"),
      );
      expect(apiKeyWarnings.length).toBe(1);
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("does not warn when env value matches profile value", async () => {
    vi.stubEnv("PAYLOAD_API_KEY", "same-key");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();

    try {
      const { loadConfig } = await import("../config.js");
      loadConfig(undefined, { apiKey: "same-key" });

      const apiKeyWarnings = warnSpy.mock.calls.filter((call) =>
        String(call[0]).includes("PAYLOAD_API_KEY"),
      );
      expect(apiKeyWarnings.length).toBe(0);
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
