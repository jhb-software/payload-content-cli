import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PayloadClient } from "../client.js";

const clientConfig = {
  payloadUrl: "http://localhost:3000",
  apiKey: "test-key",
  authCollection: "users",
  outputDir: "content",
};

describe("uploadDoc", () => {
  let client: PayloadClient;
  let lastFetchCall: { url: string; init: RequestInit } | undefined;

  beforeEach(() => {
    client = new PayloadClient(clientConfig);
    lastFetchCall = undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      lastFetchCall = { url: url as string, init: init! };
      return new Response(JSON.stringify({ doc: { id: "123", alt: "test" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  it("sends multipart form data with file and _payload", async () => {
    const fileData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const result = await client.uploadDoc(
      "media",
      { data: fileData, filename: "test.png" },
      { alt: "Test image" },
    );

    expect(result).toEqual({ id: "123", alt: "test" });
    expect(lastFetchCall).toBeDefined();
    expect(lastFetchCall!.url).toContain("/api/media");
    expect(lastFetchCall!.init.method).toBe("POST");

    const body = lastFetchCall!.init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("file")).toBeInstanceOf(Blob);
    expect(body.get("_payload")).toBe('{"alt":"Test image"}');
  });

  it("does not include Content-Type header (lets fetch set boundary)", async () => {
    const fileData = new Uint8Array([0x00]);
    await client.uploadDoc("media", { data: fileData, filename: "test.svg" });

    const headers = lastFetchCall!.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers["Authorization"]).toContain("API-Key");
  });

  it("omits _payload when no document data is provided", async () => {
    const fileData = new Uint8Array([0x00]);
    await client.uploadDoc("media", { data: fileData, filename: "test.png" });

    const body = lastFetchCall!.init.body as FormData;
    expect(body.get("file")).toBeInstanceOf(Blob);
    expect(body.get("_payload")).toBeNull();
  });

  it("includes draft status in _payload and query params", async () => {
    const fileData = new Uint8Array([0x00]);
    await client.uploadDoc(
      "media",
      { data: fileData, filename: "test.png" },
      { alt: "Draft image" },
      { draft: true },
    );

    expect(lastFetchCall!.url).toContain("draft=true");
    const body = lastFetchCall!.init.body as FormData;
    const payload = JSON.parse(body.get("_payload") as string);
    expect(payload._status).toBe("draft");
  });

  it("sets locale and depth query params", async () => {
    const fileData = new Uint8Array([0x00]);
    await client.uploadDoc(
      "media",
      { data: fileData, filename: "test.png" },
      undefined,
      { locale: "de", depth: 2 },
    );

    expect(lastFetchCall!.url).toContain("locale=de");
    expect(lastFetchCall!.url).toContain("depth=2");
  });

  it("sets correct MIME type from file extension", async () => {
    const fileData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await client.uploadDoc("media", { data: fileData, filename: "photo.jpg" });

    const body = lastFetchCall!.init.body as FormData;
    const file = body.get("file") as Blob;
    expect(file.type).toBe("image/jpeg");
  });

  it("falls back to application/octet-stream for unknown extensions", async () => {
    const fileData = new Uint8Array([0x00]);
    await client.uploadDoc("media", {
      data: fileData,
      filename: "data.xyz",
    });

    const body = lastFetchCall!.init.body as FormData;
    const file = body.get("file") as Blob;
    expect(file.type).toBe("application/octet-stream");
  });

  it("accepts a Blob as file data", async () => {
    const blob = new Blob(["<svg></svg>"], { type: "image/svg+xml" });
    await client.uploadDoc("media", { data: blob, filename: "icon.svg" });

    const body = lastFetchCall!.init.body as FormData;
    const file = body.get("file") as Blob;
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe("image/svg+xml");
  });
});

describe("upload CLI help", () => {
  it("shows upload in help output", async () => {
    const { execFileSync } = await import("node:child_process");
    const help = execFileSync("node", ["dist/cli.js", "--help"], {
      encoding: "utf-8",
    });
    expect(help).toContain("upload");
    expect(help).toContain("Upload a file to a media collection");
  });

  it("shows upload subcommand help", async () => {
    const { execFileSync } = await import("node:child_process");
    const help = execFileSync("node", ["dist/cli.js", "upload", "--help"], {
      encoding: "utf-8",
    });
    expect(help).toContain("--file");
    expect(help).toContain("--url");
    expect(help).toContain("--filename");
    expect(help).toContain("--select");
    expect(help).toContain("--dir");
    expect(help).toContain("--glob");
    expect(help).toContain("--concurrency");
    expect(help).toContain("--dry-run");
  });
});

describe("bulk upload CLI", () => {
  let tmpDir: string;
  const { execFileSync } = require("node:child_process");

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bulk-upload-test-"));
    await fs.writeFile(path.join(tmpDir, "a.jpg"), "fake-jpg");
    await fs.writeFile(path.join(tmpDir, "b.png"), "fake-png");
    await fs.writeFile(path.join(tmpDir, "c.txt"), "not-an-image");
    await fs.mkdir(path.join(tmpDir, "subdir"));
    await fs.writeFile(path.join(tmpDir, "subdir", "d.gif"), "fake-gif");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("--dir --dry-run lists files without uploading", () => {
    const output = execFileSync(
      "node",
      ["dist/cli.js", "upload", "media", "--dir", tmpDir, "--dry-run"],
      {
        encoding: "utf-8",
        env: {
          ...process.env,
          PAYLOAD_URL: "http://localhost:3000",
          PAYLOAD_API_KEY: "test",
        },
      },
    );
    expect(output).toContain("a.jpg");
    expect(output).toContain("b.png");
    expect(output).toContain("c.txt");
    // subdir files should NOT appear (non-recursive)
    expect(output).not.toContain("d.gif");
    expect(output).toContain("3 file");
  });

  it("--glob --dry-run lists only matching files", () => {
    const globPattern = path.join(tmpDir, "*.jpg");
    const output = execFileSync(
      "node",
      ["dist/cli.js", "upload", "media", "--glob", globPattern, "--dry-run"],
      {
        encoding: "utf-8",
        env: {
          ...process.env,
          PAYLOAD_URL: "http://localhost:3000",
          PAYLOAD_API_KEY: "test",
        },
      },
    );
    expect(output).toContain("a.jpg");
    expect(output).not.toContain("b.png");
    expect(output).toContain("1 file");
  });

  it("--glob with ** matches files in subdirectories", () => {
    const globPattern = path.join(tmpDir, "**", "*.gif");
    const output = execFileSync(
      "node",
      ["dist/cli.js", "upload", "media", "--glob", globPattern, "--dry-run"],
      {
        encoding: "utf-8",
        env: {
          ...process.env,
          PAYLOAD_URL: "http://localhost:3000",
          PAYLOAD_API_KEY: "test",
        },
      },
    );
    expect(output).toContain("d.gif");
  });

  it("errors when --dir and --glob are both provided", () => {
    try {
      execFileSync(
        "node",
        ["dist/cli.js", "upload", "media", "--dir", tmpDir, "--glob", "*.jpg"],
        {
          encoding: "utf-8",
          env: {
            ...process.env,
            PAYLOAD_URL: "http://localhost:3000",
            PAYLOAD_API_KEY: "test",
          },
        },
      );
      expect.fail("should have thrown");
    } catch (err: unknown) {
      const error = err as { status: number; stderr: string };
      expect(error.status).toBe(1);
      expect(error.stderr).toContain("mutually exclusive");
    }
  });

  it("errors when --dir and --file are both provided", () => {
    try {
      execFileSync(
        "node",
        [
          "dist/cli.js",
          "upload",
          "media",
          "--dir",
          tmpDir,
          "--file",
          path.join(tmpDir, "a.jpg"),
        ],
        {
          encoding: "utf-8",
          env: {
            ...process.env,
            PAYLOAD_URL: "http://localhost:3000",
            PAYLOAD_API_KEY: "test",
          },
        },
      );
      expect.fail("should have thrown");
    } catch (err: unknown) {
      const error = err as { status: number; stderr: string };
      expect(error.status).toBe(1);
      expect(error.stderr).toContain("cannot be combined");
    }
  });

  it("prints message when no files found", async () => {
    const emptyDir = path.join(tmpDir, "subdir-empty");
    await fs.mkdir(emptyDir);
    const output = execFileSync(
      "node",
      ["dist/cli.js", "upload", "media", "--dir", emptyDir, "--dry-run"],
      {
        encoding: "utf-8",
        env: {
          ...process.env,
          PAYLOAD_URL: "http://localhost:3000",
          PAYLOAD_API_KEY: "test",
        },
      },
    );
    expect(output).toContain("No files found");
  });
});
