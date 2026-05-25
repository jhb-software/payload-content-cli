import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const hasRemoteEnv = Boolean(process.env.PAYLOAD_URL && process.env.PAYLOAD_API_KEY);

const CONTENT_DIR = path.resolve("content-cli-process-test");
const CLI_ENTRY = path.resolve("src/cli.ts");
const TSX_BIN = path.resolve("node_modules/.bin/tsx");

function runCLI(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(TSX_BIN, [CLI_ENTRY, ...args], {
    encoding: "utf-8",
    env: {
      // Fake baseline env so local-only tests (lexical, arg validation) reach
      // their assertions instead of failing the early "missing env vars" check.
      // Remote tests gate on real env via hasRemoteEnv and override these.
      PAYLOAD_URL: "http://payload.invalid",
      PAYLOAD_API_KEY: "fake-key-for-local-tests",
      ...process.env,
      PAYLOAD_OUTPUT_DIR: CONTENT_DIR,
    },
  });
}

async function cleanup() {
  await fs.rm(CONTENT_DIR, { recursive: true, force: true });
}

describe.skipIf(!hasRemoteEnv)("cli (remote)", () => {
  beforeAll(async () => {
    await cleanup();
    const result = runCLI(["pull"]);
    expect(result.status, result.stderr).toBe(0);
  });

  afterAll(cleanup);

  it("push exits with code 2 on conflict", async () => {
    const dir = path.join(CONTENT_DIR, "collections", "posts");
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
    expect(files.length).toBeGreaterThan(0);
    const target = path.join(dir, files[0]);

    const raw = await fs.readFile(target, "utf-8");
    const doc = JSON.parse(raw);
    doc.title = `Local edit ${Date.now()}`;
    await fs.writeFile(target, JSON.stringify(doc, null, 2));

    // Simulate a remote change by patching the manifest's pulled timestamp
    const manifestPath = path.join(CONTENT_DIR, ".manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    const key = path.relative(CONTENT_DIR, target);
    if (manifest.documents[key]?.updatedAt) {
      manifest.documents[key].updatedAt = "1970-01-01T00:00:00.000Z";
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    }

    const result = runCLI(["push", target]);
    expect(result.status).toBe(2);
    expect(result.stderr + result.stdout).toMatch(/CONFLICT/);
    expect(result.stderr + result.stdout).toMatch(/Local file:/);
  });

  it("diff prints the legend when there are changes", async () => {
    const result = runCLI(["diff"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(
      /Legend: L> push, <R pull, !! conflict, \+L local-only, \+R remote-only/,
    );
  });

  it("pull prunes clean orphans but preserves locally-edited ones", async () => {
    // Start clean and pull localized — produces _en/_de files
    await cleanup();
    const localized = runCLI(["pull", "--collections", "posts", "--locale", "en"]);
    expect(localized.status, localized.stderr).toBe(0);

    const dir = path.join(CONTENT_DIR, "collections", "posts");
    const enFiles = (await fs.readdir(dir)).filter((f) => f.endsWith("_en.json"));
    expect(enFiles.length).toBeGreaterThan(1);

    // Locally edit one file before the next pull
    const edited = path.join(dir, enFiles[0]);
    const raw = await fs.readFile(edited, "utf-8");
    const doc = JSON.parse(raw);
    doc.title = `local edit ${Date.now()}`;
    await fs.writeFile(edited, JSON.stringify(doc, null, 2));

    // Re-pull without --locale; expect prune + preserve
    const repulled = runCLI(["pull", "--collections", "posts"]);
    expect(repulled.status, repulled.stderr).toBe(0);
    expect(repulled.stdout).toMatch(/Removed \d+ orphan file/);
    expect(repulled.stdout).toMatch(/Kept 1 orphan file/);

    // Clean orphans (non-edited) gone, edited orphan preserved
    const remaining = (await fs.readdir(dir)).filter((f) => f.endsWith("_en.json"));
    expect(remaining).toEqual([enFiles[0]]);
  });

  it("status warns about Payload-ID-shaped orphan files", async () => {
    // Cause orphans by re-pulling with --draft (writes single-locale files,
    // unsetting manifest entries for any locale files from the prior pull —
    // but only if the prior pull was localized). Without that, we synthesize
    // an orphan by dropping an ID-shaped file into the dir.
    const orphan = path.join(
      CONTENT_DIR,
      "collections",
      "posts",
      "0123456789abcdef01234567_en.json",
    );
    await fs.writeFile(orphan, JSON.stringify({ title: "orphan" }, null, 2));

    const result = runCLI(["status"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Payload-ID-shaped names/);

    await fs.rm(orphan, { force: true });
  });
});

describe("cli (local-only)", () => {
  const TMP = path.resolve(".tmp-cli-process");
  const docPath = path.join(TMP, "doc.json");

  beforeAll(async () => {
    await fs.mkdir(TMP, { recursive: true });
    await fs.writeFile(
      docPath,
      JSON.stringify(
        {
          content: {
            root: {
              type: "root",
              version: 1,
              children: [
                {
                  type: "heading",
                  tag: "h1",
                  version: 1,
                  children: [{ type: "text", text: "Title", version: 1 }],
                },
              ],
            },
          },
        },
        null,
        2,
      ),
    );
  });

  afterAll(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
  });

  it("lexical set rejects a property that does not exist on the node", () => {
    const result = runCLI([
      "lexical",
      "set",
      docPath,
      "--at",
      "0",
      "--prop",
      "text",
      "--value",
      "anything",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Property "text" does not exist on node at "0"/);
  });

  it("lexical add → set → list chain produces the expected tree", async () => {
    const add = runCLI([
      "lexical",
      "add",
      docPath,
      "--at",
      "0",
      "--position",
      "after",
      "--paragraph",
      "Hello",
    ]);
    expect(add.status, add.stderr).toBe(0);

    const set = runCLI(["lexical", "set", docPath, "--at", "0", "--prop", "tag", "--value", "h2"]);
    expect(set.status, set.stderr).toBe(0);

    const list = runCLI(["lexical", "list", docPath]);
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toMatch(/\[0\] heading "Title"/);
    expect(list.stdout).toMatch(/\[1\] paragraph "Hello"/);

    const final = JSON.parse(await fs.readFile(docPath, "utf-8"));
    expect(final.content.root.children[0].tag).toBe("h2");
  });

  it("find --where with invalid JSON exits 1 with a clear message", () => {
    const result = runCLI(["find", "posts", "--where", "title=Welcome"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--where must be valid JSON/);
  });
});

// `profile add` mutates ~/.payload-content/profiles.json, so each test
// gets its own HOME so we don't clobber the developer's real profiles.
function runProfileAddCLI(args: string[], home: string): SpawnSyncReturns<string> {
  return spawnSync(TSX_BIN, [CLI_ENTRY, "profile", "add", ...args], {
    encoding: "utf-8",
    env: { ...process.env, HOME: home },
  });
}

describe("cli profile add (validation)", () => {
  let home: string;

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "cli-profile-add-"));
  });

  afterAll(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it("rejects --api-key together with --credential-command", () => {
    const result = runProfileAddCLI(
      ["p", "--url", "https://x", "--api-key", "k", "--credential-command", "echo k"],
      home,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--api-key and --credential-command are mutually exclusive/);
  });

  it("rejects --keychain together with --credential-command", () => {
    const result = runProfileAddCLI(
      ["p", "--url", "https://x", "--keychain", "--credential-command", "echo k"],
      home,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--keychain and --credential-command are mutually exclusive/);
  });

  it("rejects --keychain-prompt without --keychain", () => {
    const result = runProfileAddCLI(
      ["p", "--url", "https://x", "--api-key", "k", "--keychain-prompt"],
      home,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--keychain-prompt requires --keychain/);
  });

  it.skipIf(process.platform !== "darwin")(
    "rejects --keychain without --api-key to seed it",
    () => {
      const result = runProfileAddCLI(["p", "--url", "https://x", "--keychain"], home);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/--keychain requires --api-key/);
    },
  );

  it("rejects an add with no fields at all", () => {
    const result = runProfileAddCLI(["p"], home);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/provide at least one of/);
  });
});
