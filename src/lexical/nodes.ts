import * as fs from "node:fs/promises";
import type {
  LexicalNode,
  LexicalElementNode,
  LexicalTextNode,
} from "./types.js";

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(
      typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf-8"),
    );
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

export function buildParagraph(text: string): LexicalElementNode {
  return {
    type: "paragraph",
    children: [buildText(text)],
    direction: "ltr",
    format: "",
    indent: 0,
    version: 1,
  };
}

export function buildHeading(
  text: string,
  tag: string = "h2",
): LexicalElementNode {
  return {
    type: "heading",
    tag,
    children: [buildText(text)],
    direction: "ltr",
    format: "",
    indent: 0,
    version: 1,
  };
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

export interface NodeArgOptions {
  paragraph?: string;
  heading?: string;
  text?: string;
  tag?: string;
  json?: string;
}

export async function parseNodeArg(
  options: NodeArgOptions,
): Promise<LexicalNode> {
  if (options.paragraph !== undefined) {
    return buildParagraph(options.paragraph);
  }
  if (options.heading !== undefined) {
    return buildHeading(options.heading, options.tag ?? "h2");
  }
  if (options.text !== undefined) {
    return buildText(options.text);
  }
  if (options.json !== undefined) {
    let raw = options.json;
    if (raw === "-") {
      raw = await readStdin();
    } else if (raw.startsWith("@")) {
      raw = await fs.readFile(raw.slice(1), "utf-8");
    }
    try {
      return JSON.parse(raw) as LexicalNode;
    } catch {
      throw new Error("Invalid JSON for --json argument");
    }
  }
  throw new Error(
    "Node input required: use --paragraph, --heading, --text, or --json",
  );
}
