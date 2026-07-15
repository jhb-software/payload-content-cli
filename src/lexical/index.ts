import { Command } from "commander";
import { wrapAction } from "../cli-helpers.js";
import { readDocument, writeDocument } from "./io.js";
import { resolveFieldPath, autoDetectLexicalField, setByPath } from "./field-path.js";
import {
  listNodes,
  getNode,
  addNode,
  replaceNode,
  removeNode,
  setNodeProp,
  linkText,
  searchText,
  extractLinks,
} from "./operations.js";
import { diffLexicalDocs } from "./diff.js";
import { parseNodeArg, buildInternalLink } from "./nodes.js";
import { assertValidTree } from "./validate.js";
import type { LexicalNode } from "./types.js";

function getChildren(
  doc: Record<string, unknown>,
  fieldOpt?: string,
): { path: string; children: LexicalNode[] } {
  if (fieldOpt) {
    return { path: fieldOpt, children: resolveFieldPath(doc, fieldOpt) };
  }
  return autoDetectLexicalField(doc);
}

/** Validate the new tree, then persist it — invalid trees are never written. */
async function writeChildren(
  file: string,
  doc: Record<string, unknown>,
  path: string,
  children: LexicalNode[],
): Promise<void> {
  assertValidTree(children);
  setByPath(doc, path, children);
  await writeDocument(file, doc);
}

export function registerLexicalCommands(program: Command): void {
  const lexical = program
    .command("lexical")
    .description("Surgical editing of Lexical richtext fields");

  lexical
    .command("list")
    .description("Show all nodes with index addresses")
    .argument("<file>", "Path to JSON document")
    .option("--field <path>", "Field path to Lexical richtext field")
    .action(
      wrapAction(async (file: string, opts: { field?: string }) => {
        const doc = await readDocument(file);
        const { children } = getChildren(doc, opts.field);
        const entries = listNodes(children);

        for (const entry of entries) {
          const depth = entry.address.split(".").length - 1;
          const indent = "  ".repeat(depth);
          const preview = entry.preview ? ` ${entry.preview}` : "";
          console.log(`${indent}[${entry.address}] ${entry.type}${preview}`);
        }
      }),
    );

  lexical
    .command("get")
    .description("Print a single node as JSON")
    .argument("<file>", "Path to JSON document")
    .requiredOption("--at <address>", "Node address (e.g. 0, 1, 2.0)")
    .option("--field <path>", "Field path to Lexical richtext field")
    .action(
      wrapAction(async (file: string, opts: { at: string; field?: string }) => {
        const doc = await readDocument(file);
        const { children } = getChildren(doc, opts.field);
        const node = getNode(children, opts.at);
        console.log(JSON.stringify(node, null, 2));
      }),
    );

  lexical
    .command("search")
    .description("Find unlinked text matches with addresses")
    .argument("<file>", "Path to JSON document")
    .requiredOption("--text <text>", "Text to search for")
    .option("--field <path>", "Field path to Lexical richtext field")
    .action(
      wrapAction(async (file: string, opts: { text: string; field?: string }) => {
        const doc = await readDocument(file);
        const { children } = getChildren(doc, opts.field);
        const matches = searchText(children, opts.text);

        if (matches.length === 0) {
          console.log("No matches found.");
          return;
        }

        for (const match of matches) {
          console.log(`[${match.address}] "${match.context}"`);
        }
      }),
    );

  lexical
    .command("add")
    .description("Insert a node relative to an address")
    .argument("<file>", "Path to JSON document")
    .requiredOption("--at <address>", "Node address (e.g. 0, 1, 2.0)")
    .requiredOption("--position <pos>", "Insert position: before, after, start, end")
    .option("--field <path>", "Field path to Lexical richtext field")
    .option("--paragraph <text>", "Create a paragraph node with text")
    .option("--heading <text>", "Create a heading node with text")
    .option("--text <text>", "Create a text node")
    .option("--tag <tag>", "Heading tag (h1-h6)", "h2")
    .option("--json <json>", "Raw JSON node, @file.json, or - for stdin")
    .action(
      wrapAction(
        async (
          file: string,
          opts: {
            at: string;
            position: string;
            field?: string;
            paragraph?: string;
            heading?: string;
            text?: string;
            tag?: string;
            json?: string;
          },
        ) => {
          const pos = opts.position as "before" | "after" | "start" | "end";
          if (!["before", "after", "start", "end"].includes(pos)) {
            throw new Error(
              `Invalid position "${opts.position}" — must be before, after, start, or end`,
            );
          }

          const node = await parseNodeArg(opts);
          const doc = await readDocument(file);
          const { path, children } = getChildren(doc, opts.field);
          const newChildren = addNode(children, opts.at, pos, node);

          await writeChildren(file, doc, path, newChildren);
          console.log(JSON.stringify({ ok: true, operation: "add", address: opts.at }));
        },
      ),
    );

  lexical
    .command("replace")
    .description("Replace a node at an address")
    .argument("<file>", "Path to JSON document")
    .requiredOption("--at <address>", "Node address (e.g. 0, 1, 2.0)")
    .option("--field <path>", "Field path to Lexical richtext field")
    .option("--paragraph <text>", "Create a paragraph node with text")
    .option("--heading <text>", "Create a heading node with text")
    .option("--text <text>", "Create a text node")
    .option("--tag <tag>", "Heading tag (h1-h6)", "h2")
    .option("--json <json>", "Raw JSON node, @file.json, or - for stdin")
    .action(
      wrapAction(
        async (
          file: string,
          opts: {
            at: string;
            field?: string;
            paragraph?: string;
            heading?: string;
            text?: string;
            tag?: string;
            json?: string;
          },
        ) => {
          const node = await parseNodeArg(opts);
          const doc = await readDocument(file);
          const { path, children } = getChildren(doc, opts.field);
          const newChildren = replaceNode(children, opts.at, node);

          await writeChildren(file, doc, path, newChildren);
          console.log(
            JSON.stringify({
              ok: true,
              operation: "replace",
              address: opts.at,
            }),
          );
        },
      ),
    );

  lexical
    .command("remove")
    .description("Remove a node at an address")
    .argument("<file>", "Path to JSON document")
    .requiredOption("--at <address>", "Node address (e.g. 0, 1, 2.0)")
    .option("--field <path>", "Field path to Lexical richtext field")
    .action(
      wrapAction(async (file: string, opts: { at: string; field?: string }) => {
        const doc = await readDocument(file);
        const { path, children } = getChildren(doc, opts.field);
        const newChildren = removeNode(children, opts.at);

        await writeChildren(file, doc, path, newChildren);
        console.log(JSON.stringify({ ok: true, operation: "remove", address: opts.at }));
      }),
    );

  lexical
    .command("set")
    .description("Update a single property on a node")
    .argument("<file>", "Path to JSON document")
    .requiredOption("--at <address>", "Node address (e.g. 0, 1, 2.0)")
    .requiredOption("--prop <key>", "Property name to set")
    .requiredOption("--value <val>", "Property value (JSON-parsed if possible)")
    .option("--field <path>", "Field path to Lexical richtext field")
    .option("--create", "Allow creating a new property that doesn't exist yet")
    .action(
      wrapAction(
        async (
          file: string,
          opts: {
            at: string;
            prop: string;
            value: string;
            field?: string;
            create?: boolean;
          },
        ) => {
          let parsedValue: unknown;
          try {
            parsedValue = JSON.parse(opts.value);
          } catch {
            parsedValue = opts.value;
          }

          const doc = await readDocument(file);
          const { path, children } = getChildren(doc, opts.field);
          const newChildren = setNodeProp(children, opts.at, opts.prop, parsedValue, {
            create: opts.create,
          });

          await writeChildren(file, doc, path, newChildren);
          console.log(JSON.stringify({ ok: true, operation: "set", address: opts.at }));
        },
      ),
    );

  lexical
    .command("link")
    .description("Wrap the first unlinked text match in an internal link (skips existing links)")
    .argument("<file>", "Path to JSON document")
    .option("--search <text>", "Text to find and wrap in a link")
    .option("--relationTo <collection>", "Target collection (e.g. countries, regions)")
    .option("--value <id>", "Target document ID")
    .option("--label <label>", "Link label (defaults to search text)")
    .option("--field <path>", "Field path to Lexical richtext field")
    .option("--from <file>", "Source file to read link from (use with --at)")
    .option("--at <address>", "Address of link node in source file (use with --from)")
    .action(
      wrapAction(
        async (
          file: string,
          opts: {
            search?: string;
            relationTo?: string;
            value?: string;
            label?: string;
            field?: string;
            from?: string;
            at?: string;
          },
        ) => {
          let search: string;
          let relationTo: string;
          let value: string;

          if (opts.from) {
            if (!opts.at) {
              throw new Error("--from requires --at");
            }
            const sourceDoc = await readDocument(opts.from);
            const { children: sourceChildren } = getChildren(sourceDoc, opts.field);
            const node = getNode(sourceChildren, opts.at);
            if (node.type !== "link") {
              throw new Error(`node at ${opts.at} is "${node.type}", not a link`);
            }
            const fields = node.fields as Record<string, unknown>;
            if (fields.linkType !== "internal" || !fields.doc) {
              throw new Error("node is not an internal link");
            }
            const sourceLinks = extractLinks([node]);
            if (sourceLinks.length === 0) {
              throw new Error("could not extract link from source node");
            }
            search = opts.search ?? sourceLinks[0].text;
            relationTo = sourceLinks[0].relationTo;
            value = sourceLinks[0].value;
          } else {
            if (!opts.search || !opts.relationTo || !opts.value) {
              throw new Error(
                "--search, --relationTo, and --value are required (or use --from --at)",
              );
            }
            search = opts.search;
            relationTo = opts.relationTo;
            value = opts.value;
          }

          const link = buildInternalLink(search, relationTo, value, opts.label);
          const doc = await readDocument(file);
          const { path, children } = getChildren(doc, opts.field);
          const newChildren = linkText(children, search, link);

          await writeChildren(file, doc, path, newChildren);
          console.log(
            JSON.stringify({
              ok: true,
              operation: "link",
              search,
              relationTo,
              value,
            }),
          );
        },
      ),
    );

  lexical
    .command("diff")
    .description("Compare links and blocks between two files (e.g. locale variants)")
    .argument("<source>", "Source file (e.g. document_de.json)")
    .argument("<target>", "Target file (e.g. document_en.json)")
    .option("--field <path>", "Field path to Lexical richtext field")
    .action(
      wrapAction(async (sourceFile: string, targetFile: string, opts: { field?: string }) => {
        const sourceDoc = await readDocument(sourceFile);
        const targetDoc = await readDocument(targetFile);
        const { children: sourceChildren } = getChildren(sourceDoc, opts.field);
        const { children: targetChildren } = getChildren(targetDoc, opts.field);

        const result = diffLexicalDocs(sourceChildren, targetChildren);

        if (result.linksOnlyInSource.length > 0) {
          console.log(`Links only in source (${result.linksOnlyInSource.length}):`);
          for (const link of result.linksOnlyInSource) {
            const matchHint = link.match
              ? link.match === link.text
                ? "  ✓ text found in target"
                : `  ✓ use --search "${link.match}"`
              : "  ✗ no match in target";
            console.log(
              `  [${link.address}] "${link.text}" → ${link.relationTo}/${link.value.slice(0, 8)}${matchHint}`,
            );
          }
          console.log();
        }

        if (result.linksOnlyInTarget.length > 0) {
          console.log(`Links only in target (${result.linksOnlyInTarget.length}):`);
          for (const link of result.linksOnlyInTarget) {
            console.log(
              `  [${link.address}] "${link.text}" → ${link.relationTo}/${link.value.slice(0, 8)}`,
            );
          }
          console.log();
        }

        if (result.blocksOnlyInSource.length > 0) {
          console.log(`Blocks only in source (${result.blocksOnlyInSource.length}):`);
          for (const block of result.blocksOnlyInSource) {
            const ctx = block.context ? `  ${block.context}` : "";
            console.log(`  [${block.address}] ${block.blockType}${ctx}`);
          }
          console.log();
        }

        if (result.blocksOnlyInTarget.length > 0) {
          console.log(`Blocks only in target (${result.blocksOnlyInTarget.length}):`);
          for (const block of result.blocksOnlyInTarget) {
            const ctx = block.context ? `  ${block.context}` : "";
            console.log(`  [${block.address}] ${block.blockType}${ctx}`);
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
