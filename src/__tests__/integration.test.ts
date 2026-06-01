import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadConfig, requireRemoteConfig } from "../config.js";
import { PayloadClient } from "../client.js";
import { pull } from "../pull.js";
import { push } from "../push.js";
import { status } from "../status.js";
import { loadManifest } from "../manifest.js";

const hasRemoteEnv = Boolean(process.env.PAYLOAD_URL && process.env.PAYLOAD_API_KEY);

const CONTENT_DIR = path.resolve("content-integration-test");

function getConfig() {
  const config = loadConfig({ outputDir: CONTENT_DIR });
  requireRemoteConfig(config);
  return config;
}

async function cleanup() {
  await fs.rm(CONTENT_DIR, { recursive: true, force: true });
}

async function readJsonDir(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir);
  return entries.filter((f) => f.endsWith(".json") && !f.startsWith("_"));
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, "utf-8"));
}

// ─── Setup & teardown ──────────────────────────────────────────────────────

describe.skipIf(!hasRemoteEnv)("integration", () => {
  let config: ReturnType<typeof getConfig>;

  beforeAll(async () => {
    config = getConfig();
    const client = new PayloadClient(config);
    const access = await client.getAccess();
    expect(access.collections.length).toBeGreaterThan(0);
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  // ─── Pull ──────────────────────────────────────────────────────────────────

  describe("pull", () => {
    beforeAll(async () => {
      await cleanup();
      await pull(config, {});
    });

    it("creates collection directories with documents", async () => {
      const postFiles = await readJsonDir(path.join(CONTENT_DIR, "collections", "posts"));
      expect(postFiles).toHaveLength(5);
    });

    it("creates global directories with data files", async () => {
      const globalFile = path.join(CONTENT_DIR, "globals", "site-settings", "site-settings.json");
      const globalContent = await readJson(globalFile);
      expect(globalContent.siteName).toBe("My Test Site");
    });

    it("writes _schema.json with field definitions for collections", async () => {
      const schema = await readJson(path.join(CONTENT_DIR, "collections", "posts", "_schema.json"));
      expect(schema.slug).toBe("posts");

      const fields = schema.fields as Array<{ name: string; type: string }>;
      const titleField = fields.find((f) => f.name === "title");
      expect(titleField).toBeDefined();
      expect(titleField!.type).toBe("text");
    });

    it("marks virtual fields in schema", async () => {
      const schema = await readJson(path.join(CONTENT_DIR, "collections", "pages", "_schema.json"));
      const fields = schema.fields as Array<{
        name: string;
        virtual?: boolean;
      }>;

      const pathField = fields.find((f) => f.name === "path");
      expect(pathField?.virtual).toBe(true);

      const breadcrumbsField = fields.find((f) => f.name === "breadcrumbs");
      expect(breadcrumbsField?.virtual).toBe(true);

      const titleField = fields.find((f) => f.name === "title");
      expect(titleField?.virtual).toBeUndefined();
    });

    it("writes _schema.json for globals", async () => {
      const schema = await readJson(
        path.join(CONTENT_DIR, "globals", "site-settings", "_schema.json"),
      );
      expect(schema.slug).toBe("site-settings");
    });

    it("writes _jsonschema.json for collections and globals", async () => {
      const collSchema = await readJson(
        path.join(CONTENT_DIR, "collections", "posts", "_jsonschema.json"),
      );
      expect(collSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(collSchema.title).toBe("posts");
      const collProps = collSchema.properties as Record<string, unknown>;
      expect(collProps.title).toBeDefined();
      expect(collProps.$schema).toBeDefined();

      const globSchema = await readJson(
        path.join(CONTENT_DIR, "globals", "site-settings", "_jsonschema.json"),
      );
      expect(globSchema.title).toBe("site-settings");
    });

    it("does not include jsonSchema inside _schema.json", async () => {
      const schema = await readJson(path.join(CONTENT_DIR, "collections", "posts", "_schema.json"));
      expect(schema.jsonSchema).toBeUndefined();
    });

    it("adds $schema reference to pulled documents", async () => {
      const postFiles = await readJsonDir(path.join(CONTENT_DIR, "collections", "posts"));
      const post = await readJson(path.join(CONTENT_DIR, "collections", "posts", postFiles[0]));
      expect(post.$schema).toBe("./_jsonschema.json");

      const global = await readJson(
        path.join(CONTENT_DIR, "globals", "site-settings", "site-settings.json"),
      );
      expect(global.$schema).toBe("./_jsonschema.json");
    });

    it("writes _localization.json with locale config", async () => {
      const loc = await readJson(path.join(CONTENT_DIR, "_localization.json"));
      expect(loc.locales).toEqual(["en", "de"]);
      expect(loc.defaultLocale).toBe("en");
    });

    it("stores relationships as IDs at depth=0", async () => {
      const postFiles = await readJsonDir(path.join(CONTENT_DIR, "collections", "posts"));
      const post = await readJson(path.join(CONTENT_DIR, "collections", "posts", postFiles[0]));

      // author must be a string ID, not a populated object
      expect(post.author).toBeDefined();
      expect(typeof post.author).toBe("string");
    });

    it("writes manifest with hash and updatedAt for every document", async () => {
      const manifest = await loadManifest(CONTENT_DIR);
      expect(manifest).not.toBeNull();
      expect(manifest!.payloadUrl).toBe(config.payloadUrl);

      const docKeys = Object.keys(manifest!.documents);
      expect(docKeys.length).toBeGreaterThanOrEqual(14); // 5 posts + 6 pages + 3 categories + 1 user + globals

      for (const [key, entry] of Object.entries(manifest!.documents)) {
        expect(entry.hash).toMatch(/^[0-9a-f]{16}$/);
        expect(key).toMatch(/\.(json)$/);
        // updatedAt can be null for some system docs but should exist
        expect("updatedAt" in entry).toBe(true);
      }
    });

    it("skips internal Payload collections", async () => {
      const collectionsDir = path.join(CONTENT_DIR, "collections");
      const dirs = await fs.readdir(collectionsDir);
      expect(dirs).not.toContain("payload-locked-documents");
      expect(dirs).not.toContain("payload-preferences");
      expect(dirs).not.toContain("payload-migrations");
    });
  });

  // ─── Status ────────────────────────────────────────────────────────────────

  describe("status", () => {
    beforeAll(async () => {
      await cleanup();
      await pull(config, {});
    });

    it("reports no changes on a fresh pull", async () => {
      const result = await status(config);
      expect(result!.modified).toHaveLength(0);
      expect(result!.added).toHaveLength(0);
      expect(result!.deleted).toHaveLength(0);
    });

    it("detects a modified document", async () => {
      const postsDir = path.join(CONTENT_DIR, "collections", "posts");
      const files = await readJsonDir(postsDir);
      const filePath = path.join(postsDir, files[0]);

      const content = await readJson(filePath);
      content.title = "MODIFIED BY TEST";
      await fs.writeFile(filePath, JSON.stringify(content, null, 2) + "\n");

      const result = await status(config);
      expect(result!.modified.length).toBe(1);
      expect(result!.modified[0]).toContain("posts/");
    });

    it("detects an added document", async () => {
      const newFile = path.join(CONTENT_DIR, "collections", "posts", "test-new-status.json");
      await fs.writeFile(newFile, JSON.stringify({ title: "New" }, null, 2) + "\n");

      const result = await status(config);
      expect(result!.added.length).toBeGreaterThanOrEqual(1);
      expect(result!.added.some((a) => a.includes("test-new-status"))).toBe(true);

      await fs.unlink(newFile);
    });

    it("detects a deleted document", async () => {
      const postsDir = path.join(CONTENT_DIR, "collections", "posts");
      const files = await readJsonDir(postsDir);
      const filePath = path.join(postsDir, files[files.length - 1]);

      // Remember the file content for restoration
      const backup = await fs.readFile(filePath, "utf-8");
      await fs.unlink(filePath);

      const result = await status(config);
      expect(result!.deleted.length).toBeGreaterThanOrEqual(1);

      // Restore
      await fs.writeFile(filePath, backup);
    });

    it("returns null when no manifest exists", async () => {
      const noManifestConfig = loadConfig({ outputDir: "/tmp/no-manifest" });
      const result = await status(noManifestConfig);
      expect(result).toBeNull();
    });
  });

  // ─── Push ──────────────────────────────────────────────────────────────────

  describe("push", () => {
    beforeAll(async () => {
      await cleanup();
      await pull(config, {});
    });

    it("updates an existing document and verifies via API", async () => {
      const postsDir = path.join(CONTENT_DIR, "collections", "posts");
      const files = await readJsonDir(postsDir);
      const filePath = path.join(postsDir, files[0]);

      const content = await readJson(filePath);
      const originalTitle = content.title;
      const testTitle = `Integration Push Test ${Date.now()}`;
      content.title = testTitle;
      await fs.writeFile(filePath, JSON.stringify(content, null, 2) + "\n");

      await push(config, { files: [filePath], force: true });

      // Verify the change landed in Payload
      const client = new PayloadClient(config);
      const doc = await client.getDoc("posts", content.id as string);
      expect(doc.title).toBe(testTitle);

      // Restore
      content.title = originalTitle;
      await fs.writeFile(filePath, JSON.stringify(content, null, 2) + "\n");
      await push(config, { files: [filePath], force: true });
    });

    it("creates a new document from a local file", async () => {
      const newFile = path.join(CONTENT_DIR, "collections", "categories", "test-push-create.json");
      await fs.writeFile(
        newFile,
        JSON.stringify(
          {
            name: "Push Create Test",
            slug: "push-create-test",
            description: "Created by integration test",
          },
          null,
          2,
        ) + "\n",
      );

      await push(config, { files: [newFile], force: true });

      // Verify via API
      const client = new PayloadClient(config);
      const response = await client.getCollectionDocs("categories", {
        limit: 100,
      });
      const created = response.docs.find(
        (d) => (d as Record<string, unknown>).slug === "push-create-test",
      ) as Record<string, unknown> | undefined;
      expect(created).toBeDefined();
      expect(created!.name).toBe("Push Create Test");

      // Cleanup remote
      if (created) {
        const deleteUrl = `${config.payloadUrl!.replace(/\/$/, "")}/api/categories/${created.id}`;
        await fetch(deleteUrl, {
          method: "DELETE",
          headers: {
            Authorization: `${config.authCollection} API-Key ${config.apiKey}`,
          },
        });
      }
      await fs.unlink(newFile);
    });

    it("updates a global", async () => {
      const globalFile = path.join(CONTENT_DIR, "globals", "site-settings", "site-settings.json");
      const content = await readJson(globalFile);
      const originalName = content.siteName;
      const testName = `Push Global Test ${Date.now()}`;
      content.siteName = testName;
      await fs.writeFile(globalFile, JSON.stringify(content, null, 2) + "\n");

      await push(config, { files: [globalFile], force: true });

      const client = new PayloadClient(config);
      const doc = await client.getGlobal("site-settings");
      expect(doc.siteName).toBe(testName);

      // Restore
      content.siteName = originalName;
      await fs.writeFile(globalFile, JSON.stringify(content, null, 2) + "\n");
      await push(config, { files: [globalFile], force: true });
    });

    it("updates the manifest after successful push", async () => {
      const postsDir = path.join(CONTENT_DIR, "collections", "posts");
      const files = await readJsonDir(postsDir);
      const filePath = path.join(postsDir, files[0]);

      const content = await readJson(filePath);
      content.title = `Manifest Update Test ${Date.now()}`;
      await fs.writeFile(filePath, JSON.stringify(content, null, 2) + "\n");

      // Before push, status shows modified
      const beforeStatus = await status(config);
      expect(beforeStatus!.modified.length).toBeGreaterThanOrEqual(1);

      await push(config, { files: [filePath], force: true });

      // After push, manifest is updated — but note the file content still differs
      // from what the server returns (we wrote it, server may add fields)
      const manifest = await loadManifest(CONTENT_DIR);
      const key = Object.keys(manifest!.documents).find((k) =>
        k.includes(files[0].replace(".json", "")),
      );
      expect(key).toBeDefined();
      expect(manifest!.documents[key!].updatedAt).toBeTruthy();
    });

    it("does not modify remote data in dry-run mode", async () => {
      const postsDir = path.join(CONTENT_DIR, "collections", "posts");
      const files = await readJsonDir(postsDir);
      const filePath = path.join(postsDir, files[0]);

      const content = await readJson(filePath);
      const client = new PayloadClient(config);
      const beforeDoc = await client.getDoc("posts", content.id as string);

      content.title = "DRY RUN SHOULD NOT APPEAR";
      await fs.writeFile(filePath, JSON.stringify(content, null, 2) + "\n");

      await push(config, { files: [filePath], dryRun: true });

      const afterDoc = await client.getDoc("posts", content.id as string);
      expect(afterDoc.title).toBe(beforeDoc.title);

      // Restore file
      content.title = beforeDoc.title;
      await fs.writeFile(filePath, JSON.stringify(content, null, 2) + "\n");
    });
  });

  // ─── Multi-locale push ───────────────────────────────────────────────────

  describe("multi-locale push", () => {
    beforeAll(async () => {
      await cleanup();
      await pull(config, { locales: ["en", "de"] });
    });

    it("pushing one locale does not flag a self-inflicted conflict on the next locale of the same document", async () => {
      const postsDir = path.join(CONTENT_DIR, "collections", "posts");
      const files = await readJsonDir(postsDir);
      const enFile = files.find((f) => f.endsWith("_en.json"))!;
      const base = enFile.replace(/_en\.json$/, "");
      const enPath = path.join(postsDir, enFile);
      const dePath = path.join(postsDir, `${base}_de.json`);

      const enContent = await readJson(enPath);
      const deContent = await readJson(dePath);
      const id = enContent.id as string;
      const originalEnTitle = enContent.title;
      const originalDeTitle = deContent.title;

      const stamp = Date.now();
      const enTitle = `EN multi-locale ${stamp}`;
      const deTitle = `DE multi-locale ${stamp}`;
      enContent.title = enTitle;
      deContent.title = deTitle;
      await fs.writeFile(enPath, JSON.stringify(enContent, null, 2) + "\n");
      await fs.writeFile(dePath, JSON.stringify(deContent, null, 2) + "\n");

      // Push DE first (bumps the document-level updatedAt), then EN. The EN push
      // must not interpret the DE push as a remote modification and skip it as a
      // conflict. No --force, so a conflict would actually block the EN write.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      try {
        await push(config, { files: [dePath] });
        await push(config, { files: [enPath] });
      } finally {
        warn.mockRestore();
        exit.mockRestore();
      }

      // Both locales must have landed. Before the fix, the EN push was skipped as
      // a conflict and the remote EN title stayed unchanged.
      const client = new PayloadClient(config);
      const enDoc = await client.getDoc("posts", id, { locale: "en" });
      const deDoc = await client.getDoc("posts", id, { locale: "de" });
      expect(enDoc.title).toBe(enTitle);
      expect(deDoc.title).toBe(deTitle);
      expect(exit).not.toHaveBeenCalled();

      // Restore both locales
      enContent.title = originalEnTitle;
      deContent.title = originalDeTitle;
      await fs.writeFile(enPath, JSON.stringify(enContent, null, 2) + "\n");
      await fs.writeFile(dePath, JSON.stringify(deContent, null, 2) + "\n");
      await push(config, { files: [enPath, dePath], force: true });
    });
  });

  // ─── Schema endpoint ──────────────────────────────────────────────────────

  describe("schema endpoint", () => {
    it("returns custom endpoints registered on the Payload instance", async () => {
      const client = new PayloadClient(config);
      const schema = (await client.getSchema()) as {
        endpoints?: {
          path: string;
          method: string;
        }[];
      } | null;

      expect(schema).not.toBeNull();
      expect(schema!.endpoints).toBeDefined();
      expect(Array.isArray(schema!.endpoints)).toBe(true);

      // The example project registers /example-plugin/stats (GET) and /example-plugin/publish-all (POST)
      const stats = schema!.endpoints!.find((ep) => ep.path === "/api/example-plugin/stats");
      expect(stats).toBeDefined();
      expect(stats!.method).toBe("get");

      const publishAll = schema!.endpoints!.find(
        (ep) => ep.path === "/api/example-plugin/publish-all",
      );
      expect(publishAll).toBeDefined();
      expect(publishAll!.method).toBe("post");
    });

    it("excludes the plugin's own /schema endpoint from the list", async () => {
      const client = new PayloadClient(config);
      const schema = (await client.getSchema()) as {
        endpoints?: { path: string }[];
      } | null;

      const schemaEndpoint = schema!.endpoints!.find((ep) => ep.path === "/api/content-cli/schema");
      expect(schemaEndpoint).toBeUndefined();
    });

    it("exposes every collection and global the CLI considers readable", async () => {
      const client = new PayloadClient(config);
      const access = await client.getAccess();
      const schema = (await client.getSchema()) as {
        collections?: Record<string, unknown>;
        globals?: Record<string, unknown>;
      } | null;

      expect(schema).not.toBeNull();

      // The plugin treats a where-clause-restricted read as access (schema is
      // shape only); the CLI's getAccess is stricter and only counts literal
      // `read: true`. So CLI-readable ⊆ schema, but not the other direction.
      const schemaCollections = new Set(Object.keys(schema!.collections ?? {}));
      const schemaGlobals = new Set(Object.keys(schema!.globals ?? {}));

      for (const slug of access.collections) {
        expect(schemaCollections.has(slug)).toBe(true);
      }
      for (const slug of access.globals) {
        expect(schemaGlobals.has(slug)).toBe(true);
      }
    });

    it("excludes built-in Payload endpoints from the list", async () => {
      const client = new PayloadClient(config);
      const schema = (await client.getSchema()) as {
        endpoints?: {
          path: string;
          method: string;
        }[];
      } | null;

      expect(schema).not.toBeNull();
      const endpoints = schema!.endpoints!;

      // Built-in CRUD and auth routes that Payload merges at runtime
      const builtInSuffixes = [
        "/:id",
        "/count",
        "/login",
        "/logout",
        "/me",
        "/refresh-token",
        "/forgot-password",
        "/reset-password",
        "/unlock",
        "/init",
        "/first-register",
        "/verify/:id",
        "/access/:id?",
        "/versions",
        "/versions/:id",
        "/:id/duplicate",
      ];

      for (const endpoint of endpoints) {
        for (const suffix of builtInSuffixes) {
          expect(endpoint.path.endsWith(suffix)).toBe(false);
        }
      }
    });
  });

  // ─── Versions, restore, duplicate ────────────────────────────────────────────

  describe("versions", () => {
    let postId: string;
    let versionId: string;

    beforeAll(async () => {
      const client = new PayloadClient(config);
      // Pick a post to work with
      const docs = await client.getCollectionDocs("posts", {
        limit: 1,
        depth: 0,
      });
      postId = docs.docs[0].id as string;

      // Update it to generate a version (requires versions.drafts on the collection)
      await client.updateDoc("posts", postId, {
        excerpt: "version-test-original",
      });
      await client.updateDoc("posts", postId, {
        excerpt: "version-test-updated",
      });
    });

    it("lists versions for a collection", async () => {
      const client = new PayloadClient(config);
      const result = await client.getVersions("posts", {
        limit: 5,
        depth: 0,
      });

      expect(result.docs.length).toBeGreaterThan(0);
      const version = result.docs[0] as Record<string, unknown>;
      expect(version.id).toBeDefined();
      expect(version.parent).toBeDefined();
      expect(version.version).toBeDefined();

      // Save a version ID for later tests
      versionId = version.id as string;
    });

    it("gets a specific version by ID", async () => {
      const client = new PayloadClient(config);
      const version = await client.getVersion("posts", versionId, { depth: 0 });

      expect(version.id).toBe(versionId);
      expect(version.version).toBeDefined();
      const inner = version.version as Record<string, unknown>;
      expect(inner.title).toBeDefined();
    });

    it("restores a version", async () => {
      const client = new PayloadClient(config);

      // Find the version with the original excerpt
      const versions = await client.getVersions("posts", {
        depth: 0,
      });
      const originalVersion = (versions.docs as Record<string, unknown>[]).find(
        (v) =>
          ((v.version as Record<string, unknown>).excerpt as string) === "version-test-original",
      );
      expect(originalVersion).toBeDefined();

      const restored = await client.restoreVersion("posts", originalVersion!.id as string, {
        depth: 0,
      });
      expect(restored.excerpt).toBe("version-test-original");
    });
  });

  describe("duplicate", () => {
    it("duplicates a document", async () => {
      const client = new PayloadClient(config);
      const docs = await client.getCollectionDocs("posts", {
        limit: 1,
        depth: 0,
      });
      const original = docs.docs[0];
      const originalTitle = original.title as string;

      const duplicate = await client.duplicateDoc("posts", original.id as string, { depth: 0 });

      expect(duplicate.id).not.toBe(original.id);
      expect(duplicate.title).toContain(originalTitle);

      // Clean up
      await client.deleteDoc("posts", duplicate.id as string);
    });
  });

  // ─── Select with group sub-fields ─────────────────────────────────────────

  describe("select", () => {
    it("returns only selected group sub-field", async () => {
      const client = new PayloadClient(config);
      const docs = await client.getCollectionDocs("posts", {
        limit: 1,
        depth: 0,
        select: { meta: { title: true } },
      });

      const doc = docs.docs[0] as Record<string, unknown>;
      const meta = doc.meta as Record<string, unknown>;
      expect(meta.title).toBeDefined();
      expect(meta.description).toBeUndefined();
    });

    it("excludes a group sub-field while keeping others", async () => {
      const client = new PayloadClient(config);
      const docs = await client.getCollectionDocs("posts", {
        limit: 1,
        depth: 0,
        select: { meta: { description: false } },
      });

      const doc = docs.docs[0] as Record<string, unknown>;
      const meta = doc.meta as Record<string, unknown>;
      expect(meta.title).toBeDefined();
      expect(meta.description).toBeUndefined();
    });
  });

  // ─── Pull with locale ──────────────────────────────────────────────────────

  describe("pull with locale", () => {
    it("pulls a specific locale with locale-suffixed filenames", async () => {
      await cleanup();
      await pull(config, { locales: ["de"] });

      const postsDir = path.join(CONTENT_DIR, "collections", "posts");
      const files = await readJsonDir(postsDir);

      // Files should have _de suffix
      expect(files.every((f) => f.endsWith("_de.json"))).toBe(true);

      const post = await readJson(path.join(postsDir, files[0]));
      // Localized fields must be flat strings
      expect(typeof post.title).toBe("string");
    });

    it("pulls multiple locales creating separate files per locale", async () => {
      await cleanup();
      await pull(config, { locales: ["en", "de"] });

      const postsDir = path.join(CONTENT_DIR, "collections", "posts");
      const files = await readJsonDir(postsDir);

      const enFiles = files.filter((f) => f.endsWith("_en.json"));
      const deFiles = files.filter((f) => f.endsWith("_de.json"));
      expect(enFiles.length).toBeGreaterThan(0);
      expect(deFiles.length).toBeGreaterThan(0);
      expect(enFiles.length).toBe(deFiles.length);
    });

    it("records locale in document keys via filename suffix", async () => {
      await cleanup();
      await pull(config, { locales: ["de"] });

      const manifest = await loadManifest(CONTENT_DIR);
      const keys = Object.keys(manifest!.documents);
      expect(keys.every((k) => k.endsWith("_de.json"))).toBe(true);
    });

    it("omits locale from filenames and manifest keys when not specified", async () => {
      await cleanup();
      await pull(config, {});

      const postsDir = path.join(CONTENT_DIR, "collections", "posts");
      const files = await readJsonDir(postsDir);
      // No locale suffix
      expect(files.every((f) => !f.includes("_en.json") && !f.includes("_de.json"))).toBe(true);

      const manifest = await loadManifest(CONTENT_DIR);
      const keys = Object.keys(manifest!.documents);
      expect(keys.every((k) => !k.includes("_en.json") && !k.includes("_de.json"))).toBe(true);
    });
  });
}); // describe.skipIf
