import * as fs from "node:fs/promises";
import type { LexicalNode, LexicalElementNode, LexicalTextNode } from "./types.js";
import { LexicalError } from "./errors.js";

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf-8"));
  }
  return chunks.join("");
}

export function buildText(text: string): LexicalTextNode {
  return {
    type: "text",
    text,
    detail: 0,
    format: 0,
    mode: "normal",
    style: "",
    version: 1,
  };
}

/**
 * Inline content for an element builder: plain text for the common case, or
 * ready-made inline nodes (formatted text, links) when the caller has built
 * them itself.
 */
export type InlineContent = string | LexicalNode[];

function toInlineChildren(content: InlineContent): LexicalNode[] {
  return typeof content === "string" ? [buildText(content)] : content;
}

/** Base props every Lexical element node carries. */
function element(type: string, children: LexicalNode[]): LexicalElementNode {
  return { type, children, direction: "ltr", format: "", indent: 0, version: 1 };
}

/**
 * An element node of any type — the escape hatch for nodes without a dedicated
 * builder, so callers don't hand-roll the base props Payload expects.
 */
export function buildElement(type: string, children: LexicalNode[] = []): LexicalElementNode {
  return element(type, children);
}

export function buildParagraph(content: InlineContent): LexicalElementNode {
  return element("paragraph", toInlineChildren(content));
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

export function buildHeading(content: InlineContent, tag: string = "h2"): LexicalElementNode {
  if (!HEADING_TAGS.includes(tag)) {
    throw new LexicalError(
      "INVALID_NODE",
      `Invalid heading tag "${tag}" — must be one of ${HEADING_TAGS.join(", ")}`,
    );
  }
  return { ...element("heading", toInlineChildren(content)), tag };
}

const LIST_TYPES = ["bullet", "number", "check"] as const;
type ListType = (typeof LIST_TYPES)[number];

// Lexical's ListNode serializes `listType` alongside the HTML `tag`; a checklist
// is a `ul` that renders checkboxes. Item `value`s are 1-based and are what an
// ordered list numbers from.
const LIST_TAGS: Record<ListType, string> = { bullet: "ul", number: "ol", check: "ul" };

export function buildList(
  items: InlineContent[],
  listType: ListType = "bullet",
): LexicalElementNode {
  if (!LIST_TYPES.includes(listType)) {
    throw new LexicalError(
      "INVALID_NODE",
      `Invalid list type "${listType}" — must be one of ${LIST_TYPES.join(", ")}`,
    );
  }
  return {
    ...element("list", []),
    listType,
    tag: LIST_TAGS[listType],
    start: 1,
    children: items.map((item, index) => ({
      ...element("listitem", toInlineChildren(item)),
      value: index + 1,
    })),
  };
}

/** Horizontal rules are leaf nodes — no children, no format or indent. */
export function buildHorizontalRule(): LexicalNode {
  return { type: "horizontalrule", version: 1 };
}

/**
 * Wrap a Payload block's field values in a `block` decorator node. `fields` must
 * carry the `blockType` slug — without it Payload can't resolve which block the
 * node is, and the value silently fails validation on save.
 */
export function buildBlock(fields: Record<string, unknown>): LexicalNode {
  if (typeof fields.blockType !== "string" || fields.blockType === "") {
    throw new LexicalError(
      "INVALID_NODE",
      'Block fields must include a "blockType" slug naming the block',
    );
  }
  return { type: "block", fields, format: "", version: 2 };
}

export function buildInternalLink(
  text: string,
  relationTo: string,
  value: string,
  label?: string,
): LexicalElementNode {
  return {
    type: "link",
    version: 3,
    children: [buildText(text)],
    direction: "ltr",
    format: "",
    indent: 0,
    fields: {
      linkType: "internal",
      doc: {
        label: label ?? text,
        relationTo,
        value,
      },
    },
  };
}

/**
 * A JSON argument as the CLI takes it: inline, `@file.json`, or `-` for stdin.
 * Text that isn't JSON comes back as-is when `fallback` allows it.
 */
export async function readJsonArg(
  raw: string,
  fallback: "string" | "error" = "error",
): Promise<unknown> {
  let text = raw;
  if (raw === "-") {
    text = await readStdin();
  } else if (raw.startsWith("@")) {
    text = await fs.readFile(raw.slice(1), "utf-8");
  }
  try {
    return JSON.parse(text);
  } catch {
    if (fallback === "string") return text;
    throw new Error(`Not valid JSON: ${text.length > 60 ? `${text.slice(0, 59)}…` : text}`);
  }
}
