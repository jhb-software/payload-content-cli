#!/usr/bin/env node

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createRequire } from "node:module";
import { Command, Help } from "commander";

import {
  buildKeychainCommand,
  deleteFromMacKeychain,
  isManagedKeychainCommand,
  keychainEntryFor,
  storeInMacKeychain,
} from "./keychain.js";

const pkg = createRequire(import.meta.url)("../package.json") as {
  version: string;
};
import { loadConfig, requireRemoteConfig, resolvePayloadProfile } from "./config.js";
import { pull } from "./pull.js";
import { push } from "./push.js";
import { status, printStatus } from "./status.js";
import { diff, printDiff } from "./diff.js";
import { find as findLocal, printFindResults, type FindOptions } from "./find.js";
import { PayloadClient } from "./client.js";
import { parseSelect } from "./select.js";
import { registerLexicalCommands } from "./lexical/index.js";
import {
  resolveProfile,
  setProfile,
  removeProfile,
  loadProfiles,
  maskApiKey,
  materializeProfile,
  runCredentialCommand,
  getProfile,
} from "./profiles.js";
import type { Profile } from "./profiles.js";
import {
  parseCommonOpts,
  parsePaginationOpts,
  parsePublishOpts,
  parseJson,
  readDataFile,
  resolveData,
  wrapAction,
} from "./cli-helpers.js";

const program = new Command();

program
  .name("payload-content")
  .description("A CLI for managing Payload CMS content, built for AI agents")
  .version(pkg.version)
  .configureHelp({
    formatHelp(cmd, helper) {
      if (cmd !== program) {
        return Help.prototype.formatHelp.call(helper, cmd, helper);
      }
      const termWidth = helper.padWidth(cmd, helper);

      const groups: Record<string, string[]> = {
        "CRUD (no plugin needed)": [
          "find",
          "create",
          "update",
          "delete",
          "count",
          "versions",
          "restore",
          "duplicate",
          "upload",
          "request",
        ],
        "Content sync": ["pull", "push", "status", "diff"],
        Utilities: ["me", "discover", "skill", "lexical", "clean", "profile"],
      };

      const cmds = new Map(cmd.commands.map((c: Command) => [c.name(), c]));

      let output = `Usage: ${helper.commandUsage(cmd)}\n\n`;
      output += `${cmd.description()}\n`;

      for (const [group, names] of Object.entries(groups)) {
        output += `\n${group}:\n`;
        for (const name of names) {
          const sub = cmds.get(name);
          if (!sub) continue;
          const term = helper.subcommandTerm(sub);
          const desc = helper.subcommandDescription(sub);
          output += helper.formatItem(term, termWidth, desc, helper) + "\n";
        }
      }

      const globalOpts = helper.visibleOptions(cmd);
      if (globalOpts.length > 0) {
        output += `\nOptions:\n`;
        for (const opt of globalOpts) {
          const term = helper.optionTerm(opt);
          const desc = helper.optionDescription(opt);
          output += helper.formatItem(term, termWidth, desc, helper) + "\n";
        }
      }

      output += `\nEnvironment variables (set in .env or shell):\n`;
      output += `  PAYLOAD_URL              Payload server URL (required)\n`;
      output += `  PAYLOAD_API_KEY          API key for authentication (required)\n`;
      output += `  PAYLOAD_AUTH_COLLECTION  Auth collection slug (default: "api-keys")\n`;
      output += `  PAYLOAD_OUTPUT_DIR       Local content directory (default: "content")\n`;
      output += `  PAYLOAD_PROFILE          Default profile name (same as --profile)\n`;
      output += `\nQuick start: set PAYLOAD_URL and PAYLOAD_API_KEY, then run 'payload-content me' to verify.\n`;
      output += `Tip: use 'payload-content profile add <name>' to save connection settings for reuse.\n`;

      return output;
    },
  });

program.option(
  "--profile <name>",
  "Use a named profile for connection settings (see 'profile' command)",
);

// ── Helpers ──────────────────────────────────────────────────────────

async function pooled<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

async function getConfig(overrides?: Parameters<typeof loadConfig>[0]) {
  const profileName = program.opts().profile ?? resolvePayloadProfile();
  const raw = profileName ? await resolveProfile(profileName) : undefined;
  const profile = raw ? await materializeProfile(raw) : undefined;
  return loadConfig(overrides, profile);
}

function parseSlug(slug: string): { isGlobal: boolean; slug: string } {
  if (slug.startsWith("globals/")) {
    return { isGlobal: true, slug: slug.slice("globals/".length) };
  }
  return { isGlobal: false, slug };
}

function parseWhere(raw: string): Record<string, unknown> {
  return parseJson(raw, "--where");
}

function parseData(raw: string): Record<string, unknown> {
  return parseJson(raw, "--data");
}

// ── CRUD commands ────────────────────────────────────────────────────

program
  .command("find")
  .description("Search documents in a collection or global. Use --local to search pulled files.")
  .argument("<slug>", "Collection slug or globals/<slug>")
  .argument("[id]", "Document ID (returns single document)")
  .option("--local", "Search pulled local files instead of the API")
  .option("--where <json>", 'Payload query filter as JSON (e.g. \'{"slug":{"equals":"hello"}}\')')
  .option("--select <json>", "Fields to include/exclude as JSON")
  .option("--limit <n>", "Max documents to return")
  .option("--sort <field>", "Sort field (prefix - for desc)")
  .option("--depth <n>", "Relationship population depth")
  .option("--locale <code>", "Locale for localized fields")
  .option("--fallback-locale <code>", "Fallback locale if primary unavailable")
  .option("--draft", "Include draft documents")
  .option("--trash", "Include soft-deleted documents")
  .option("--joins <json>", "Join field options as JSON")
  .option("--populate <json>", "Populate options as JSON")
  .option("--pagination", "Include pagination metadata (use --no-pagination to exclude)")
  .action(
    wrapAction(async (slug: string, id: string | undefined, opts: Record<string, unknown>) => {
      if (opts.local) {
        // Local mode: search pulled files
        const config = await getConfig();
        const { slug: resolvedSlug } = parseSlug(slug);
        const localWhere: Record<string, string> = {};
        if (opts.where) {
          const parsed = parseWhere(opts.where as string);
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "object" && v !== null) {
              const inner = v as Record<string, unknown>;
              const val = inner.equals ?? inner.like ?? Object.values(inner)[0];
              if (val !== undefined) localWhere[k] = String(val);
            } else {
              localWhere[k] = String(v);
            }
          }
        }
        const localOpts: FindOptions = {
          collection: resolvedSlug,
          select: opts.select ? parseSelect(opts.select as string) : undefined,
          where: Object.keys(localWhere).length > 0 ? localWhere : undefined,
        };
        const results = await findLocal(config, localOpts);
        printFindResults(results);
        if (results.length === 0) process.exit(1);
        return;
      }

      // Remote mode: query the API
      const config = await getConfig();
      requireRemoteConfig(config);
      const client = new PayloadClient(config);
      const { isGlobal, slug: resolvedSlug } = parseSlug(slug);
      const common = parseCommonOpts(opts);

      let data: unknown;

      if (isGlobal) {
        data = await client.getGlobal(resolvedSlug, common);
      } else if (id) {
        data = await client.getDoc(resolvedSlug, id, common);
      } else {
        const where = opts.where ? parseWhere(opts.where as string) : undefined;
        data = await client.getCollectionDocs(resolvedSlug, {
          ...common,
          ...parsePaginationOpts(opts),
          where,
        });
      }

      console.log(JSON.stringify(data, null, 2));
    }),
  );

program
  .command("create")
  .description("Create a new document in a collection")
  .argument("<slug>", "Collection slug")
  .option("--data <json>", "Document data as JSON string")
  .option("--file <path>", "Read document data from a JSON file")
  .option("--locale <code>", "Locale for localized fields")
  .option("--fallback-locale <code>", "Fallback locale if primary unavailable")
  .option("--depth <n>", "Relationship population depth in response")
  .option("--select <json>", "Fields to include/exclude as JSON")
  .option("--populate <json>", "Populate options as JSON")
  .option("--draft", "Create as draft")
  .option("--autosave", "Mark as autosave")
  .option("--publish-specific-locale <code>", "Publish only this locale")
  .option("--publish-all-locales", "Publish all locales")
  .action(
    wrapAction(async (slug: string, opts: Record<string, unknown>) => {
      const config = await getConfig();
      requireRemoteConfig(config);
      const client = new PayloadClient(config);
      const data = await resolveData(opts);
      const result = await client.createDoc(slug, data, {
        ...parseCommonOpts(opts),
        ...parsePublishOpts(opts),
      });
      console.log(JSON.stringify(result, null, 2));
    }),
  );

program
  .command("update")
  .description("Update a document by ID or a global")
  .argument("<slug>", "Collection slug or globals/<slug>")
  .argument("[id]", "Document ID (required for collections)")
  .option("--data <json>", "Update data as JSON string")
  .option("--file <path>", "Read update data from a JSON file")
  .option(
    "--where <json>",
    'Update multiple documents matching this filter (e.g. \'{"status":{"equals":"draft"}}\')',
  )
  .option("--locale <code>", "Locale for localized fields")
  .option("--fallback-locale <code>", "Fallback locale if primary unavailable")
  .option("--depth <n>", "Relationship population depth in response")
  .option("--select <json>", "Fields to include/exclude as JSON")
  .option("--populate <json>", "Populate options as JSON")
  .option("--draft", "Update as draft")
  .option("--trash", "Include soft-deleted documents")
  .option("--autosave", "Mark as autosave")
  .option("--override-lock", "Override document lock")
  .option("--publish-specific-locale <code>", "Publish only this locale")
  .option("--publish-all-locales", "Publish all locales")
  .option("--unpublish-all-locales", "Unpublish all locales")
  .action(
    wrapAction(async (slug: string, id: string | undefined, opts: Record<string, unknown>) => {
      const config = await getConfig();
      requireRemoteConfig(config);
      const client = new PayloadClient(config);
      const { isGlobal, slug: resolvedSlug } = parseSlug(slug);
      const data = await resolveData(opts);
      const common = parseCommonOpts(opts);
      const publish = parsePublishOpts(opts);

      let result: unknown;

      if (isGlobal) {
        result = await client.updateGlobal(resolvedSlug, data, {
          ...common,
          ...publish,
        });
      } else if (id) {
        result = await client.updateDoc(resolvedSlug, id, data, {
          ...common,
          ...publish,
          overrideLock: opts.overrideLock as boolean | undefined,
        });
      } else if (opts.where) {
        // Bulk update via PATCH with where params
        const where = parseWhere(opts.where as string);
        const whereParams: Record<string, string> = {};
        for (const [k, v] of Object.entries(where)) {
          if (typeof v === "object" && v !== null) {
            for (const [op, val] of Object.entries(v as Record<string, unknown>)) {
              whereParams[`where[${k}][${op}]`] = String(val);
            }
          } else {
            whereParams[`where[${k}][equals]`] = String(v);
          }
        }
        result = await client.rawPatch(
          `${resolvedSlug}?${new URLSearchParams(whereParams).toString()}`,
          data,
        );
      } else {
        console.error("Error: provide a document ID or --where for bulk update.");
        process.exit(1);
      }

      console.log(JSON.stringify(result, null, 2));
    }),
  );

program
  .command("delete")
  .description("Delete a document by ID or by query")
  .argument("<slug>", "Collection slug")
  .argument("[id]", "Document ID")
  .option(
    "--where <json>",
    'Delete documents matching this filter (e.g. \'{"status":{"equals":"draft"}}\')',
  )
  .option("--depth <n>", "Relationship population depth in response")
  .option("--select <json>", "Fields to include/exclude as JSON")
  .option("--populate <json>", "Populate options as JSON")
  .option("--trash", "Include soft-deleted documents")
  .option("--override-lock", "Override document lock")
  .action(
    wrapAction(async (slug: string, id: string | undefined, opts: Record<string, unknown>) => {
      const config = await getConfig();
      requireRemoteConfig(config);
      const client = new PayloadClient(config);
      const common = parseCommonOpts(opts);
      const deleteOpts = {
        ...common,
        overrideLock: opts.overrideLock as boolean | undefined,
      };

      let result: unknown;

      if (id) {
        result = await client.deleteDoc(slug, id, deleteOpts);
      } else if (opts.where) {
        const where = parseWhere(opts.where as string);
        result = await client.deleteDocs(slug, where, deleteOpts);
      } else {
        console.error("Error: provide a document ID or --where.");
        process.exit(1);
      }

      console.log(JSON.stringify(result, null, 2));
    }),
  );

program
  .command("count")
  .description("Count documents in a collection")
  .argument("<slug>", "Collection slug")
  .option(
    "--where <json>",
    'Payload query filter as JSON (e.g. \'{"status":{"equals":"published"}}\')',
  )
  .option("--trash", "Include soft-deleted documents in count")
  .action(
    wrapAction(async (slug: string, opts: Record<string, unknown>) => {
      const config = await getConfig();
      requireRemoteConfig(config);
      const client = new PayloadClient(config);
      const where = opts.where ? parseWhere(opts.where as string) : undefined;
      const total = await client.countDocs(slug, where, {
        trash: opts.trash as boolean | undefined,
      });
      console.log(total);
    }),
  );

program
  .command("versions")
  .description("List versions for a collection or global, or get a specific version")
  .argument("<slug>", "Collection slug or globals/<slug>")
  .argument("[id]", "Version ID (returns single version)")
  .option(
    "--where <json>",
    'Payload query filter as JSON (e.g. \'{"version._status":{"equals":"draft"}}\')',
  )
  .option("--limit <n>", "Max versions to return")
  .option("--sort <field>", "Sort field (prefix - for desc)")
  .option("--depth <n>", "Relationship population depth")
  .option("--locale <code>", "Locale for localized fields")
  .option("--fallback-locale <code>", "Fallback locale if primary unavailable")
  .option("--select <json>", "Fields to include/exclude as JSON")
  .option("--populate <json>", "Populate options as JSON")
  .option("--page <n>", "Page number for pagination")
  .option("--pagination", "Include pagination metadata (use --no-pagination to exclude)")
  .option("--trash", "Include soft-deleted document versions")
  .action(
    wrapAction(async (slug: string, id: string | undefined, opts: Record<string, unknown>) => {
      const config = await getConfig();
      requireRemoteConfig(config);
      const client = new PayloadClient(config);
      const { isGlobal, slug: resolvedSlug } = parseSlug(slug);
      const common = parseCommonOpts(opts);
      const pagination = parsePaginationOpts(opts);

      let data: unknown;

      if (isGlobal) {
        if (id) {
          data = await client.getGlobalVersion(resolvedSlug, id, common);
        } else {
          const where = opts.where ? parseWhere(opts.where as string) : undefined;
          data = await client.getGlobalVersions(resolvedSlug, {
            ...common,
            ...pagination,
            where,
          });
        }
      } else if (id) {
        data = await client.getVersion(resolvedSlug, id, common);
      } else {
        const where = opts.where ? parseWhere(opts.where as string) : undefined;
        data = await client.getVersions(resolvedSlug, {
          ...common,
          ...pagination,
          where,
        });
      }

      console.log(JSON.stringify(data, null, 2));
    }),
  );

program
  .command("restore")
  .description("Restore a document or global to a previous version")
  .argument("<slug>", "Collection slug or globals/<slug>")
  .argument("<id>", "Version ID to restore")
  .option("--depth <n>", "Relationship population depth")
  .option("--draft", "Restore as draft")
  .option("--populate <json>", "Populate options as JSON")
  .action(
    wrapAction(async (slug: string, id: string, opts: Record<string, unknown>) => {
      const config = await getConfig();
      requireRemoteConfig(config);
      const client = new PayloadClient(config);
      const { isGlobal, slug: resolvedSlug } = parseSlug(slug);
      const common = parseCommonOpts(opts);

      let data: unknown;

      if (isGlobal) {
        data = await client.restoreGlobalVersion(resolvedSlug, id, common);
      } else {
        data = await client.restoreVersion(resolvedSlug, id, common);
      }

      console.log(JSON.stringify(data, null, 2));
    }),
  );

program
  .command("duplicate")
  .description("Duplicate a document in a collection")
  .argument("<slug>", "Collection slug")
  .argument("<id>", "Document ID to duplicate")
  .option("--depth <n>", "Relationship population depth")
  .option("--select <json>", "Fields to include/exclude as JSON")
  .option("--populate <json>", "Populate options as JSON")
  .option("--draft", "Create duplicate as draft")
  .option("--locale <code>", "Locale for localized fields")
  .action(
    wrapAction(async (slug: string, id: string, opts: Record<string, unknown>) => {
      const config = await getConfig();
      requireRemoteConfig(config);
      const client = new PayloadClient(config);
      const result = await client.duplicateDoc(slug, id, parseCommonOpts(opts));
      console.log(JSON.stringify(result, null, 2));
    }),
  );

program
  .command("upload")
  .description("Upload a file to a media collection")
  .argument("<slug>", "Collection slug (must be an upload-enabled collection)")
  .option("--file <path>", "Local file path to upload")
  .option("--url <url>", "Upload file from URL (fetched server-side by Payload)")
  .option("--data <json>", "Document field data as JSON string (e.g. alt text)")
  .option("--filename <name>", "Override the filename sent to Payload")
  .option("--select <json>", "Fields to include/exclude as JSON")
  .option("--locale <code>", "Locale for localized fields")
  .option("--fallback-locale <code>", "Fallback locale if primary unavailable")
  .option("--depth <n>", "Relationship population depth in response")
  .option("--populate <json>", "Populate options as JSON")
  .option("--draft", "Create as draft")
  .option("--autosave", "Mark as autosave")
  .option("--publish-specific-locale <code>", "Publish only this locale")
  .option("--publish-all-locales", "Publish all locales")
  .option("--dir <path>", "Upload all files from a directory")
  .option("--glob <pattern>", "Upload files matching a glob pattern")
  .option("--concurrency <n>", "Max parallel uploads (default: 5)", "5")
  .option("--dry-run", "List files without uploading")
  .action(
    wrapAction(async (slug: string, opts: Record<string, unknown>) => {
      const config = await getConfig();
      requireRemoteConfig(config);
      const client = new PayloadClient(config);

      const docData = opts.data ? parseData(opts.data as string) : {};
      const uploadOpts = {
        ...parseCommonOpts(opts),
        ...parsePublishOpts(opts),
      };

      // Bulk upload path
      if (opts.dir || opts.glob) {
        if (opts.dir && opts.glob) {
          console.error("Error: --dir and --glob are mutually exclusive.");
          process.exit(1);
        }
        if (opts.file || opts.url) {
          console.error("Error: --dir/--glob cannot be combined with --file or --url.");
          process.exit(1);
        }

        let files: string[];
        if (opts.dir) {
          const entries = await fs.readdir(opts.dir as string, {
            withFileTypes: true,
          });
          files = entries
            .filter((e) => e.isFile())
            .map((e) => path.join(opts.dir as string, e.name))
            .sort();
        } else {
          files = [];
          for await (const entry of fs.glob(opts.glob as string)) {
            const stat = await fs.stat(entry);
            if (stat.isFile()) files.push(entry);
          }
          files.sort();
        }

        if (files.length === 0) {
          console.log("No files found.");
          return;
        }

        console.log(
          `${opts.dryRun ? "[dry-run] " : ""}Uploading ${files.length} file${files.length === 1 ? "" : "s"} to ${slug}...`,
        );

        if (opts.dryRun) {
          for (const file of files) {
            console.log(`  ${path.basename(file)}`);
          }
          return;
        }

        let uploaded = 0;
        let errors = 0;
        const concurrency = Math.max(1, Number(opts.concurrency) || 5);

        const tasks = files.map((filePath) => async () => {
          const filename = path.basename(filePath);
          const fileData = new Uint8Array(await fs.readFile(filePath));
          try {
            await client.uploadDoc(slug, { data: fileData, filename }, docData, uploadOpts);
            uploaded++;
            console.log(`  Uploaded ${filename}`);
          } catch (err) {
            errors++;
            console.error(`  Failed ${filename}: ${(err as Error).message}`);
          }
        });

        await pooled(tasks, concurrency);

        console.log(`\nDone. ${uploaded} uploaded, ${errors} error${errors === 1 ? "" : "s"}.`);
        if (errors > 0) process.exit(1);
        return;
      }

      // Single file upload path
      let result: Record<string, unknown>;

      if (opts.url) {
        const urlPath = new URL(opts.url as string).pathname;
        const filename =
          (opts.filename as string | undefined) ?? (path.basename(urlPath) || "download");
        result = await client.createDoc(slug, { ...docData, url: opts.url, filename }, uploadOpts);
      } else {
        let fileData: Uint8Array;
        let filename: string;

        if (opts.file) {
          fileData = new Uint8Array(await fs.readFile(opts.file as string));
          filename = (opts.filename as string | undefined) ?? path.basename(opts.file as string);
        } else if (!process.stdin.isTTY) {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
          }
          fileData = new Uint8Array(Buffer.concat(chunks));
          filename = (opts.filename as string | undefined) ?? "upload";
        } else {
          console.error("Error: provide --file, --url, or pipe data to stdin.");
          process.exit(1);
        }

        result = await client.uploadDoc(slug, { data: fileData, filename }, docData, uploadOpts);
      }

      console.log(JSON.stringify(result, null, 2));
    }),
  );

program
  .command("request")
  .description("Send a raw HTTP request to any Payload REST API endpoint")
  .argument("<method>", "HTTP method: GET, POST, PATCH, DELETE")
  .argument("<path>", "API path (e.g. custom-endpoint, some-plugin/action)")
  .option("--file <path>", "Read request body from a JSON file")
  .option("--data <json>", "Request body as inline JSON string")
  .action(
    wrapAction(async (method: string, apiPath: string, opts: Record<string, unknown>) => {
      const config = await getConfig();
      requireRemoteConfig(config);
      const client = new PayloadClient(config);

      const upperMethod = method.toUpperCase();
      let result: unknown;

      if (upperMethod === "GET") {
        result = await client.rawGet(apiPath);
      } else if (upperMethod === "POST") {
        let body: unknown = {};
        if (opts.file) body = await readDataFile(opts.file as string);
        else if (opts.data) body = parseData(opts.data as string);
        result = await client.rawPost(apiPath, body);
      } else if (upperMethod === "PATCH") {
        let body: unknown = {};
        if (opts.file) body = await readDataFile(opts.file as string);
        else if (opts.data) body = parseData(opts.data as string);
        result = await client.rawPatch(apiPath, body);
      } else if (upperMethod === "DELETE") {
        result = await client.rawDelete(apiPath);
      } else {
        console.error(`Error: unsupported method "${method}". Use GET, POST, PATCH, or DELETE.`);
        process.exit(1);
      }

      console.log(JSON.stringify(result, null, 2));
    }),
  );

// ── Content sync commands ────────────────────────────────────────────

program
  .command("pull")
  .description("Pull all content from Payload CMS to local files")
  .option("--locale <codes...>", "Locale(s) to pull (e.g. --locale en de)")
  .option("--draft", "Pull draft versions instead of published")
  .option("--collections <slugs...>", "Only pull specific collections")
  .option("--globals <slugs...>", "Only pull specific globals")
  .option("--where <json>", 'Payload query filter as JSON (e.g. \'{"tenant":{"equals":"acme"}}\')')
  .option("--allow-url-change", "Repoint the manifest at a different server URL (use with care)")
  .action(
    wrapAction(async (opts: Record<string, unknown>) => {
      if ((opts.locale as string[] | undefined)?.includes("all")) {
        console.error(
          'Error: --locale "all" is not supported. Specify individual locales (e.g. --locale en de).',
        );
        process.exit(1);
      }

      const where = opts.where ? parseWhere(opts.where as string) : undefined;
      const config = await getConfig();

      await pull(config, {
        locales: opts.locale as string[] | undefined,
        draft: opts.draft as boolean | undefined,
        collections: opts.collections as string[] | undefined,
        globals: opts.globals as string[] | undefined,
        where,
        allowUrlChange: opts.allowUrlChange as boolean | undefined,
      });
    }),
  );

program
  .command("push")
  .description("Push local content files back to Payload CMS")
  .option("--dry-run", "Show what would be pushed without making changes")
  .option("--force", "Overwrite remote changes even if there are conflicts")
  .option("--draft", "Push as draft versions")
  .option(
    "--allow-url-change",
    "Push to a different server than the manifest was pulled from (use with care)",
  )
  .argument("[files...]", "Specific files to push (default: modified + added)")
  .action(
    wrapAction(async (files: string[], opts: Record<string, unknown>) => {
      const config = await getConfig();
      await push(config, {
        files: files.length ? files : undefined,
        dryRun: opts.dryRun as boolean | undefined,
        force: opts.force as boolean | undefined,
        draft: opts.draft as boolean | undefined,
        allowUrlChange: opts.allowUrlChange as boolean | undefined,
      });
    }),
  );

program
  .command("status")
  .description("Show local changes since last pull")
  .action(
    wrapAction(async () => {
      const config = await getConfig();
      const result = await status(config);
      printStatus(result);
    }),
  );

program
  .command("diff")
  .description("Compare local content against the remote Payload instance")
  .action(
    wrapAction(async () => {
      const config = await getConfig();
      const result = await diff(config);
      printDiff(result);
    }),
  );

// ── Utility commands ─────────────────────────────────────────────────

program
  .command("me")
  .description("Verify authentication and show the current user")
  .action(
    wrapAction(async () => {
      const config = await getConfig();
      requireRemoteConfig(config);
      const client = new PayloadClient(config);

      const user = await client.getMe(config.authCollection);
      if (!user) {
        console.error(
          `Authentication failed: no user returned from /${config.authCollection}/me.\n\n` +
            `Check that PAYLOAD_API_KEY is valid and belongs to a user in the "${config.authCollection}" collection.`,
        );
        process.exit(1);
      }

      console.log(`Authenticated as: ${config.authCollection}/${user.email ?? user.id}`);
    }),
  );

program
  .command("discover")
  .description("Discover available collections, globals, and custom endpoints")
  .action(
    wrapAction(async () => {
      const config = await getConfig();
      requireRemoteConfig(config);
      const client = new PayloadClient(config);

      const access = await client.getAccess();
      if (access.collections.length) {
        console.log(`Collections: ${access.collections.join(", ")}`);
      }
      if (access.globals.length) {
        console.log(`Globals: ${access.globals.join(", ")}`);
      }

      const schema = await client.getSchema();
      if (schema) {
        console.log(
          "Plugin: installed — schema metadata, virtual-field stripping, and custom endpoint metadata enabled",
        );
        const endpoints = schema.endpoints as
          | {
              path: string;
              method: string;
              description?: string;
              schema?: {
                query?: Record<string, unknown>;
                body?: Record<string, unknown>;
                response?: Record<string, unknown>;
              };
            }[]
          | undefined;
        if (endpoints?.length) {
          console.log("Custom endpoints:");
          for (const ep of endpoints) {
            const method = ep.method.toUpperCase().padEnd(6);
            console.log(`  ${method} ${ep.path}`);
            if (ep.description) {
              console.log(`         ${ep.description}`);
            }
            if (ep.schema?.query) {
              console.log(`         query:    ${JSON.stringify(ep.schema.query)}`);
            }
            if (ep.schema?.body) {
              console.log(`         body:     ${JSON.stringify(ep.schema.body)}`);
            }
            if (ep.schema?.response) {
              console.log(`         response: ${JSON.stringify(ep.schema.response)}`);
            }
          }
        }
      } else {
        console.log(
          "Plugin: not installed — pull still works, but without _schema.json, _jsonschema.json, virtual-field stripping, or custom endpoint metadata.",
        );
        console.log(
          "  Install: import { contentCliPlugin } from 'payload-content-cli/plugin' and add contentCliPlugin() to plugins in payload.config.ts.",
        );
      }
    }),
  );

program
  .command("skill")
  .description("Install the agent skill file for this project")
  .option("--output <path>", "Output file path", ".claude/skills/payload-content/SKILL.md")
  .action(
    wrapAction(async (opts: Record<string, unknown>) => {
      const sourcePath = new URL("./agent-skill.md", import.meta.url);
      const content = await fs.readFile(sourcePath, "utf-8");
      const outputPath = path.resolve(opts.output as string);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, content, "utf-8");
      console.log(`Wrote ${outputPath}`);
    }),
  );

program
  .command("clean")
  .description("Delete the content directory and start fresh")
  .option("--yes", "Skip confirmation prompt")
  .action(
    wrapAction(async (opts: Record<string, unknown>) => {
      const config = await getConfig();
      const outputDir = path.resolve(config.outputDir);

      if (!opts.yes) {
        const rl = await import("node:readline/promises");
        const prompt = rl.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await prompt.question(
          `This will delete ${outputDir}/ and any unpushed changes. Continue? (y/N) `,
        );
        prompt.close();
        if (answer.toLowerCase() !== "y") {
          console.log("Aborted.");
          return;
        }
      }

      await fs.rm(outputDir, { recursive: true, force: true });
      console.log(`Deleted ${outputDir}/`);
    }),
  );

registerLexicalCommands(program);

// ── Profile commands ────────────────────────────────────────────────

const profileCmd = program
  .command("profile")
  .description("Manage connection profiles (~/.payload-content/profiles.json)");

profileCmd
  .command("list")
  .description("List all saved profiles")
  .action(
    wrapAction(async () => {
      const profiles = await loadProfiles();
      const names = Object.keys(profiles);
      if (names.length === 0) {
        console.log(
          "No profiles configured. Run 'payload-content profile add <name>' to create one.",
        );
        return;
      }
      for (const [name, profile] of Object.entries(profiles)) {
        const url = profile.payloadUrl ?? "(no URL)";
        console.log(`${name}  ${url}`);
      }
    }),
  );

profileCmd
  .command("add")
  .description("Create or update a profile")
  .argument("<name>", "Profile name")
  .option("--url <url>", "Payload server URL")
  .option(
    "--api-key <key>",
    "API key (stored plaintext unless --keychain or --credential-command is used)",
  )
  .option(
    "--credential-command <cmd>",
    "Shell command that prints the API key to stdout (e.g. \"op read 'op://Private/payload/api-key'\")",
  )
  .option(
    "--keychain",
    "macOS only: store --api-key in the login Keychain and reference it via `security`",
  )
  .option(
    "--keychain-prompt",
    "macOS only: tighten the Keychain ACL so every read shows a Keychain access prompt (default: silent reads via `security`)",
  )
  .option("--auth-collection <slug>", "Auth collection slug")
  .option("--output-dir <dir>", "Local content directory")
  .action(
    wrapAction(async (name: string, opts: Record<string, unknown>) => {
      const hasAnything =
        opts.url ||
        opts.apiKey ||
        opts.credentialCommand ||
        opts.keychain ||
        opts.authCollection ||
        opts.outputDir;
      if (!hasAnything) {
        console.error(
          "Error: provide at least one of --url, --api-key, --credential-command, --auth-collection, --output-dir.",
        );
        process.exit(1);
      }

      if (opts.apiKey && opts.credentialCommand) {
        console.error("Error: --api-key and --credential-command are mutually exclusive.");
        process.exit(1);
      }

      if (opts.keychain && opts.credentialCommand) {
        console.error(
          "Error: --keychain and --credential-command are mutually exclusive (--keychain writes its own credentialCommand).",
        );
        process.exit(1);
      }

      if (opts.keychainPrompt && !opts.keychain) {
        console.error("Error: --keychain-prompt requires --keychain.");
        process.exit(1);
      }

      const profile: Profile = {};
      if (opts.url) profile.payloadUrl = opts.url as string;
      if (opts.authCollection) profile.authCollection = opts.authCollection as string;
      if (opts.outputDir) profile.outputDir = opts.outputDir as string;

      if (opts.keychain) {
        if (process.platform !== "darwin") {
          console.error("Error: --keychain is only supported on macOS.");
          process.exit(1);
        }
        if (!opts.apiKey) {
          console.error("Error: --keychain requires --api-key to seed the Keychain entry.");
          process.exit(1);
        }
        const { service, account } = keychainEntryFor(name);
        const promptOnAccess = Boolean(opts.keychainPrompt);
        await storeInMacKeychain(service, account, opts.apiKey as string, { promptOnAccess });
        profile.credentialCommand = buildKeychainCommand(name);
        const aclNote = promptOnAccess ? " — prompts on every read" : " — silent reads";
        console.log(
          `Stored API key in macOS Keychain (service="${service}", account="${account}")${aclNote}.`,
        );
      } else if (opts.credentialCommand) {
        profile.credentialCommand = opts.credentialCommand as string;
      } else if (opts.apiKey) {
        profile.apiKey = opts.apiKey as string;
      }

      await setProfile(name, profile);

      // Verify the helper round-trips before the user discovers it at runtime.
      // Print "saved" last so the verify outcome is visible alongside it instead
      // of scrolling off after a delayed Keychain prompt.
      if (profile.credentialCommand) {
        try {
          const key = await runCredentialCommand(profile.credentialCommand);
          console.log(`Verified credentialCommand returns a ${key.length}-char key.`);
        } catch (err) {
          console.warn(`Warning: ${(err as Error).message}`);
        }
      }
      console.log(`Profile "${name}" saved.`);
    }),
  );

profileCmd
  .command("remove")
  .description("Delete a profile")
  .argument("<name>", "Profile name")
  .action(
    wrapAction(async (name: string) => {
      const existing = await getProfile(name);
      const ownsKeychainEntry =
        process.platform === "darwin" &&
        isManagedKeychainCommand(name, existing?.credentialCommand);

      const removed = await removeProfile(name);
      if (!removed) {
        console.error(`Profile "${name}" not found.`);
        process.exit(1);
      }

      if (ownsKeychainEntry) {
        const { service, account } = keychainEntryFor(name);
        try {
          const result = await deleteFromMacKeychain(service, account);
          if (result === "deleted") {
            console.log(
              `Deleted macOS Keychain entry (service="${service}", account="${account}").`,
            );
          } else {
            console.log(
              `macOS Keychain entry (service="${service}", account="${account}") was already gone.`,
            );
          }
        } catch (err) {
          console.warn(`Warning: ${(err as Error).message}`);
        }
      }

      console.log(`Profile "${name}" removed.`);
    }),
  );

profileCmd
  .command("show")
  .description("Show a profile's settings (API key is masked)")
  .argument("<name>", "Profile name")
  .action(
    wrapAction(async (name: string) => {
      const profile = await resolveProfile(name);
      const { apiKey, ...rest } = profile;
      const redacted = apiKey !== undefined ? { ...rest, apiKey: maskApiKey(apiKey) } : rest;
      console.log(JSON.stringify(redacted, null, 2));
    }),
  );

program.parse();
