import { Command } from "commander";
import { wrapAction } from "../cli-helpers.js";
import { readDocument, writeDocument } from "./io.js";
import { editAtPath, readAtPath, valueAtPath } from "./path.js";
import type { PathEdit } from "./path.js";
import { diffRichText, linkRichText, richTextPaths, searchRichText } from "./read.js";
import { extractLinks } from "./operations.js";
import { readJsonArg } from "./nodes.js";
import type { LinkTarget } from "./nodes.js";
import { isLinkNode } from "./types.js";
import type { LexicalNode } from "./types.js";

const PATH_HELP =
  "Dot path, e.g. content, content.3, layout.1.richText.3.fields.body.0.children.1.fields.doc";

const SCOPE_HELP = "Rich text at or below this path. Default: the whole document";

/** Apply a change at a path, save the file, and print what changed. */
async function edit(
  file: string,
  path: string,
  operation: PathEdit,
  value?: unknown,
): Promise<void> {
  const { result, doc } = editAtPath(await readDocument(file), path, operation, value);
  await writeDocument(file, doc);
  console.log(JSON.stringify(result, null, 2));
}

function isOutline(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((line) => typeof line === "string");
}

export function registerLexicalCommands(program: Command): void {
  const lexical = program
    .command("lexical")
    .description("Read and edit Lexical rich text in a JSON document by dot path");

  lexical
    .command("read")
    .description(
      "Outline the rich text at a path, or show the node or value there. Without a path, outlines every rich-text field",
    )
    .argument("<file>", "Path to JSON document")
    .argument("[path]", PATH_HELP)
    .option("--full", "Print the stored JSON, e.g. to pipe into insert --json -")
    .action(
      wrapAction(async (file: string, path: string | undefined, opts: { full?: boolean }) => {
        const doc = await readDocument(file);
        if (path === undefined) {
          if (opts.full) throw new Error("--full needs a path.");
          const outlines = richTextPaths(doc).map((field) => readAtPath(doc, field) as string[]);
          console.log(outlines.map((lines) => lines.join("\n")).join("\n\n"));
          return;
        }
        if (opts.full) {
          console.log(JSON.stringify(valueAtPath(doc, path), null, 2));
          return;
        }
        const view = readAtPath(doc, path);
        console.log(isOutline(view) ? view.join("\n") : JSON.stringify(view, null, 2));
      }),
    );

  lexical
    .command("set")
    .description("Replace the node or value at a path")
    .argument("<file>", "Path to JSON document")
    .argument("<path>", PATH_HELP)
    .argument("[value]", "New value; JSON-parsed unless the current value is a string")
    .option("--json <json>", "Value as JSON, @file.json, or - for stdin")
    .action(
      wrapAction(
        async (file: string, path: string, raw: string | undefined, opts: { json?: string }) => {
          let value: unknown;
          if (opts.json !== undefined) {
            value = await readJsonArg(opts.json);
          } else if (raw !== undefined) {
            const current = valueAtPath(await readDocument(file), path);
            value = typeof current === "string" ? raw : await readJsonArg(raw, "string");
          } else {
            throw new Error("Pass the new value, or --json.");
          }
          await edit(file, path, "set", value);
        },
      ),
    );

  lexical
    .command("insert")
    .description(
      'Insert a node before the index a path ends in; the node count appends. Shorthand works: {"type":"p","text":"…"}',
    )
    .argument("<file>", "Path to JSON document")
    .argument("<path>", "Dot path ending in a node index, e.g. content.3")
    .argument("[node]", "Node as JSON")
    .option("--json <json>", "Node as JSON, @file.json, or - for stdin")
    .action(
      wrapAction(
        async (file: string, path: string, node: string | undefined, opts: { json?: string }) => {
          const raw = opts.json ?? node;
          if (raw === undefined) throw new Error("Pass the node as JSON, or --json.");
          await edit(file, path, "insert", await readJsonArg(raw));
        },
      ),
    );

  lexical
    .command("delete")
    .description("Delete the node at a path")
    .argument("<file>", "Path to JSON document")
    .argument("<path>", "Dot path ending in a node index, e.g. content.3")
    .action(wrapAction(async (file: string, path: string) => edit(file, path, "delete")));

  lexical
    .command("search")
    .description("Find text in rich text, nested rich text included; marks matches inside a link")
    .argument("<file>", "Path to JSON document")
    .argument("[path]", SCOPE_HELP)
    .requiredOption("--text <text>", "Text to search for")
    .action(
      wrapAction(async (file: string, path: string | undefined, opts: { text: string }) => {
        const matches = searchRichText(await readDocument(file), path ?? "", opts.text);
        if (matches.length === 0) {
          console.log("No matches found.");
          return;
        }
        for (const match of matches) {
          console.log(`[${match.path}] "${match.context}"${match.linked ? " (linked)" : ""}`);
        }
      }),
    );

  lexical
    .command("link")
    .description("Wrap the first unlinked match of text in an internal link")
    .argument("<file>", "Path to JSON document")
    .argument("[path]", SCOPE_HELP)
    .option("--text <text>", "Text to find and wrap in a link")
    .option("--relationTo <collection>", "Target collection (e.g. pages)")
    .option("--value <id>", "Target document ID")
    .option("--from <file>", "File to copy a link's target from (use with --link)")
    .option("--link <path>", "Path of the link node in the --from file")
    .action(
      wrapAction(
        async (
          file: string,
          path: string | undefined,
          opts: {
            text?: string;
            relationTo?: string;
            value?: string;
            from?: string;
            link?: string;
          },
        ) => {
          let text: string;
          let target: LinkTarget;

          if (opts.from) {
            if (!opts.link) throw new Error("--from needs --link <path>.");
            const node = valueAtPath(await readDocument(opts.from), opts.link) as LexicalNode;
            const [source] = isLinkNode(node) ? extractLinks([node], opts.link) : [];
            if (!source) {
              throw new Error(`${opts.link} in ${opts.from} is not an internal link.`);
            }
            text = opts.text ?? source.text;
            target = { relationTo: source.relationTo, value: source.value };
          } else {
            if (!opts.text || !opts.relationTo || !opts.value) {
              throw new Error(
                "--text, --relationTo and --value are required (or use --from --link)",
              );
            }
            text = opts.text;
            target = { relationTo: opts.relationTo, value: opts.value };
          }

          const linked = linkRichText(await readDocument(file), path ?? "", text, target);
          await writeDocument(file, linked.doc);
          console.log(JSON.stringify({ linked: linked.path, text, ...target }));
        },
      ),
    );

  lexical
    .command("diff")
    .description("Compare links and blocks between two files (e.g. locale variants)")
    .argument("<source>", "Source file (e.g. document_de.json)")
    .argument("<target>", "Target file (e.g. document_en.json)")
    .argument("[path]", SCOPE_HELP)
    .action(
      wrapAction(async (sourceFile: string, targetFile: string, path: string | undefined) => {
        const sourceDoc = await readDocument(sourceFile);
        const targetDoc = await readDocument(targetFile);
        const result = diffRichText(sourceDoc, targetDoc, path ?? "");

        if (result.linksOnlyInSource.length > 0) {
          console.log(`Links only in source (${result.linksOnlyInSource.length}):`);
          for (const link of result.linksOnlyInSource) {
            const matchHint = link.match
              ? link.match === link.text
                ? "  ✓ text found in target"
                : `  ✓ use --text "${link.match}"`
              : "  ✗ no match in target";
            console.log(
              `  [${link.path}] "${link.text}" → ${link.relationTo}/${link.value.slice(0, 8)}${matchHint}`,
            );
          }
          console.log();
        }

        if (result.linksOnlyInTarget.length > 0) {
          console.log(`Links only in target (${result.linksOnlyInTarget.length}):`);
          for (const link of result.linksOnlyInTarget) {
            console.log(
              `  [${link.path}] "${link.text}" → ${link.relationTo}/${link.value.slice(0, 8)}`,
            );
          }
          console.log();
        }

        if (result.blocksOnlyInSource.length > 0) {
          console.log(`Blocks only in source (${result.blocksOnlyInSource.length}):`);
          for (const block of result.blocksOnlyInSource) {
            const ctx = block.context ? `  ${block.context}` : "";
            console.log(`  [${block.path}] ${block.blockType}${ctx}`);
          }
          console.log();
        }

        if (result.blocksOnlyInTarget.length > 0) {
          console.log(`Blocks only in target (${result.blocksOnlyInTarget.length}):`);
          for (const block of result.blocksOnlyInTarget) {
            const ctx = block.context ? `  ${block.context}` : "";
            console.log(`  [${block.path}] ${block.blockType}${ctx}`);
          }
          console.log();
        }

        if (result.linksInBoth.length > 0) {
          console.log(`Links in both (${result.linksInBoth.length}):`);
          for (const link of result.linksInBoth) {
            console.log(`  "${link.text}" → ${link.relationTo}/${link.value.slice(0, 8)}`);
          }
          console.log();
        }

        if (result.inSync) {
          console.log("Files are in sync.");
        }
      }),
    );
}
