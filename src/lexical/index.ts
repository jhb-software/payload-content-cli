import { Command } from "commander";
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
  extractBlocks,
} from "./operations.js";
import { parseNodeArg, buildInternalLink } from "./nodes.js";
import { validateTree } from "./validate.js";
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

function printValidationWarnings(children: LexicalNode[]): void {
  const warnings = validateTree(children);
  for (const warning of warnings) {
    console.error(`warning: ${warning}`);
  }
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
    .action(async (file: string, opts: { field?: string }) => {
      try {
        const doc = await readDocument(file);
        const { children } = getChildren(doc, opts.field);
        const entries = listNodes(children);

        for (const entry of entries) {
          const depth = entry.address.split(".").length - 1;
          const indent = "  ".repeat(depth);
          const preview = entry.preview ? ` ${entry.preview}` : "";
          console.log(`${indent}[${entry.address}] ${entry.type}${preview}`);
        }
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
    });

  lexical
    .command("get")
    .description("Print a single node as JSON")
    .argument("<file>", "Path to JSON document")
    .requiredOption("--at <address>", "Node address (e.g. 0, 1, 2.0)")
    .option("--field <path>", "Field path to Lexical richtext field")
    .action(async (file: string, opts: { at: string; field?: string }) => {
      try {
        const doc = await readDocument(file);
        const { children } = getChildren(doc, opts.field);
        const node = getNode(children, opts.at);
        console.log(JSON.stringify(node, null, 2));
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
    });

  lexical
    .command("search")
    .description("Find unlinked text matches with addresses")
    .argument("<file>", "Path to JSON document")
    .requiredOption("--text <text>", "Text to search for")
    .option("--field <path>", "Field path to Lexical richtext field")
    .action(async (file: string, opts: { text: string; field?: string }) => {
      try {
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
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
    });

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
        try {
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

          setByPath(doc, path, newChildren);
          await writeDocument(file, doc);
          printValidationWarnings(newChildren);
          console.log(JSON.stringify({ ok: true, operation: "add", address: opts.at }));
        } catch (error) {
          console.error("Error:", (error as Error).message);
          process.exit(1);
        }
      },
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
        try {
          const node = await parseNodeArg(opts);
          const doc = await readDocument(file);
          const { path, children } = getChildren(doc, opts.field);
          const newChildren = replaceNode(children, opts.at, node);

          setByPath(doc, path, newChildren);
          await writeDocument(file, doc);
          printValidationWarnings(newChildren);
          console.log(
            JSON.stringify({
              ok: true,
              operation: "replace",
              address: opts.at,
            }),
          );
        } catch (error) {
          console.error("Error:", (error as Error).message);
          process.exit(1);
        }
      },
    );

  lexical
    .command("remove")
    .description("Remove a node at an address")
    .argument("<file>", "Path to JSON document")
    .requiredOption("--at <address>", "Node address (e.g. 0, 1, 2.0)")
    .option("--field <path>", "Field path to Lexical richtext field")
    .action(async (file: string, opts: { at: string; field?: string }) => {
      try {
        const doc = await readDocument(file);
        const { path, children } = getChildren(doc, opts.field);
        const newChildren = removeNode(children, opts.at);

        setByPath(doc, path, newChildren);
        await writeDocument(file, doc);
        printValidationWarnings(newChildren);
        console.log(JSON.stringify({ ok: true, operation: "remove", address: opts.at }));
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
    });

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
        try {
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

          setByPath(doc, path, newChildren);
          await writeDocument(file, doc);
          printValidationWarnings(newChildren);
          console.log(JSON.stringify({ ok: true, operation: "set", address: opts.at }));
        } catch (error) {
          console.error("Error:", (error as Error).message);
          process.exit(1);
        }
      },
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
        try {
          let search: string;
          let relationTo: string;
          let value: string;

          if (opts.from) {
            if (!opts.at) {
              console.error("Error: --from requires --at");
              process.exit(1);
            }
            const sourceDoc = await readDocument(opts.from);
            const { children: sourceChildren } = getChildren(sourceDoc, opts.field);
            const node = getNode(sourceChildren, opts.at);
            if (node.type !== "link") {
              console.error(`Error: node at ${opts.at} is "${node.type}", not a link`);
              process.exit(1);
            }
            const fields = node.fields as Record<string, unknown>;
            if (fields.linkType !== "internal" || !fields.doc) {
              console.error("Error: node is not an internal link");
              process.exit(1);
            }
            const sourceLinks = extractLinks([node]);
            if (sourceLinks.length === 0) {
              console.error("Error: could not extract link from source node");
              process.exit(1);
            }
            search = opts.search ?? sourceLinks[0].text;
            relationTo = sourceLinks[0].relationTo;
            value = sourceLinks[0].value;
          } else {
            if (!opts.search || !opts.relationTo || !opts.value) {
              console.error(
                "Error: --search, --relationTo, and --value are required (or use --from --at)",
              );
              process.exit(1);
            }
            search = opts.search;
            relationTo = opts.relationTo;
            value = opts.value;
          }

          const link = buildInternalLink(search, relationTo, value, opts.label);
          const doc = await readDocument(file);
          const { path, children } = getChildren(doc, opts.field);
          const newChildren = linkText(children, search, link);

          setByPath(doc, path, newChildren);
          await writeDocument(file, doc);
          printValidationWarnings(newChildren);
          console.log(
            JSON.stringify({
              ok: true,
              operation: "link",
              search,
              relationTo,
              value,
            }),
          );
        } catch (error) {
          console.error("Error:", (error as Error).message);
          process.exit(1);
        }
      },
    );

  lexical
    .command("diff")
    .description("Compare links and blocks between two files (e.g. locale variants)")
    .argument("<source>", "Source file (e.g. document_de.json)")
    .argument("<target>", "Target file (e.g. document_en.json)")
    .option("--field <path>", "Field path to Lexical richtext field")
    .action(async (sourceFile: string, targetFile: string, opts: { field?: string }) => {
      try {
        const sourceDoc = await readDocument(sourceFile);
        const targetDoc = await readDocument(targetFile);
        const { children: sourceChildren } = getChildren(sourceDoc, opts.field);
        const { children: targetChildren } = getChildren(targetDoc, opts.field);

        // Compare links
        const sourceLinks = extractLinks(sourceChildren);
        const targetLinks = extractLinks(targetChildren);

        const targetLinkKeys = new Set(
          targetLinks.map((link) => `${link.relationTo}:${link.value}`),
        );
        const sourceLinkKeys = new Set(
          sourceLinks.map((link) => `${link.relationTo}:${link.value}`),
        );

        const onlyInSource = sourceLinks.filter(
          (link) => !targetLinkKeys.has(`${link.relationTo}:${link.value}`),
        );
        const onlyInTarget = targetLinks.filter(
          (link) => !sourceLinkKeys.has(`${link.relationTo}:${link.value}`),
        );
        const inBoth = sourceLinks.filter((link) =>
          targetLinkKeys.has(`${link.relationTo}:${link.value}`),
        );

        // Compare blocks
        const sourceBlocks = extractBlocks(sourceChildren);
        const targetBlocks = extractBlocks(targetChildren);

        const targetBlockTypes = new Set(targetBlocks.map((block) => block.blockType));
        const sourceBlockTypes = new Set(sourceBlocks.map((block) => block.blockType));

        const blocksOnlyInSource = sourceBlocks.filter(
          (block) => !targetBlockTypes.has(block.blockType),
        );
        const blocksOnlyInTarget = targetBlocks.filter(
          (block) => !sourceBlockTypes.has(block.blockType),
        );

        // For each missing link, check if the text exists in the target
        type LinkWithMatch = (typeof onlyInSource)[number] & {
          match?: string;
        };
        const onlyInSourceWithMatches: LinkWithMatch[] = onlyInSource.map((link) => {
          // Try exact match first
          const exactMatches = searchText(targetChildren, link.text);
          if (exactMatches.length > 0) {
            return { ...link, match: link.text };
          }
          // Try significant words (4+ chars, longest first, split on spaces and hyphens)
          const stopWords = new Set([
            "the",
            "and",
            "for",
            "with",
            "from",
            "that",
            "this",
            "your",
            "der",
            "die",
            "das",
            "und",
            "für",
            "mit",
            "von",
            "den",
            "dem",
            "des",
            "ein",
            "eine",
            "sich",
            "nach",
            "zur",
            "zum",
            "ist",
            "sind",
            "hat",
            "haben",
            "wird",
            "werden",
            "kann",
            "nicht",
            "auch",
            "oder",
            "aber",
            "wie",
            "was",
            "wir",
          ]);
          const words = link.text
            .split(/[\s\-–]+/)
            .filter((word) => word.length >= 4 && !stopWords.has(word.toLowerCase()))
            .sort((a, b) => b.length - a.length);
          for (const word of words) {
            const wordMatches = searchText(targetChildren, word);
            if (wordMatches.length > 0) {
              return { ...link, match: word };
            }
          }
          return link;
        });

        // Output
        if (onlyInSourceWithMatches.length > 0) {
          console.log(`Links only in source (${onlyInSourceWithMatches.length}):`);
          for (const link of onlyInSourceWithMatches) {
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

        if (onlyInTarget.length > 0) {
          console.log(`Links only in target (${onlyInTarget.length}):`);
          for (const link of onlyInTarget) {
            console.log(
              `  [${link.address}] "${link.text}" → ${link.relationTo}/${link.value.slice(0, 8)}`,
            );
          }
          console.log();
        }

        if (blocksOnlyInSource.length > 0) {
          console.log(`Blocks only in source (${blocksOnlyInSource.length}):`);
          for (const block of blocksOnlyInSource) {
            const ctx = block.context ? `  ${block.context}` : "";
            console.log(`  [${block.address}] ${block.blockType}${ctx}`);
          }
          console.log();
        }

        if (blocksOnlyInTarget.length > 0) {
          console.log(`Blocks only in target (${blocksOnlyInTarget.length}):`);
          for (const block of blocksOnlyInTarget) {
            const ctx = block.context ? `  ${block.context}` : "";
            console.log(`  [${block.address}] ${block.blockType}${ctx}`);
          }
          console.log();
        }

        if (inBoth.length > 0) {
          console.log(`Links in both (${inBoth.length}):`);
          for (const link of inBoth) {
            console.log(`  "${link.text}" → ${link.relationTo}/${link.value.slice(0, 8)}`);
          }
          console.log();
        }

        if (
          onlyInSource.length === 0 &&
          onlyInTarget.length === 0 &&
          blocksOnlyInSource.length === 0 &&
          blocksOnlyInTarget.length === 0
        ) {
          console.log("Files are in sync.");
        }
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
    });
}
