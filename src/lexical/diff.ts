import type { LexicalNode } from "./types.js";
import { extractLinks, extractBlocks, searchText } from "./operations.js";
import type { ExtractedLink, ExtractedBlock } from "./operations.js";

/** One rich-text value: its dot path and top-level nodes. */
export interface RichTextSection {
  path: string;
  children: LexicalNode[];
}

/** Common English/German stop words excluded from the fuzzy word-match heuristic. */
const DIFF_STOP_WORDS: ReadonlySet<string> = new Set([
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

/** A link missing from the target, annotated with a text-match hint when one exists. */
export interface SourceLinkDiff extends ExtractedLink {
  /**
   * Exact link text (if found unlinked in the target) or the longest
   * significant word from it that appears unlinked in the target.
   */
  match?: string;
}

export interface LexicalDiffResult {
  linksOnlyInSource: SourceLinkDiff[];
  linksOnlyInTarget: ExtractedLink[];
  linksInBoth: ExtractedLink[];
  blocksOnlyInSource: ExtractedBlock[];
  blocksOnlyInTarget: ExtractedBlock[];
  inSync: boolean;
}

/**
 * Fuzzy text-match heuristic: does the link's text (or a significant word from
 * it) exist as unlinked text in the target? Used to suggest `lexical link --search`.
 */
function findTextMatch(text: string, target: RichTextSection[]): string | undefined {
  const found = (search: string) =>
    target.some(({ path, children }) => searchText(children, path, search).length > 0);
  // Try exact match first
  if (found(text)) {
    return text;
  }
  // Try significant words (4+ chars, longest first, split on spaces and hyphens)
  const words = text
    .split(/[\s\-–]+/)
    .filter((w) => w.length >= 4 && !DIFF_STOP_WORDS.has(w.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  for (const word of words) {
    if (found(word)) {
      return word;
    }
  }
  return undefined;
}

/**
 * Compare internal links and blocks between two sets of rich text
 * (e.g. a field and the rich text nested in it, in two locale variants of a document).
 */
export function diffLexicalDocs(
  source: RichTextSection[],
  target: RichTextSection[],
): LexicalDiffResult {
  const linkKey = (l: ExtractedLink) => `${l.relationTo}:${l.value}`;

  const links = (sections: RichTextSection[]) =>
    sections.flatMap(({ path, children }) => extractLinks(children, path));
  const blocks = (sections: RichTextSection[]) =>
    sections.flatMap(({ path, children }) => extractBlocks(children, path));
  const sourceLinks = links(source);
  const targetLinks = links(target);
  const sourceLinkKeys = new Set(sourceLinks.map(linkKey));
  const targetLinkKeys = new Set(targetLinks.map(linkKey));

  const linksOnlyInSource: SourceLinkDiff[] = sourceLinks
    .filter((l) => !targetLinkKeys.has(linkKey(l)))
    .map((l) => {
      const match = findTextMatch(l.text, target);
      return match === undefined ? { ...l } : { ...l, match };
    });
  const linksOnlyInTarget = targetLinks.filter((l) => !sourceLinkKeys.has(linkKey(l)));
  const linksInBoth = sourceLinks.filter((l) => targetLinkKeys.has(linkKey(l)));

  const sourceBlocks = blocks(source);
  const targetBlocks = blocks(target);
  const sourceBlockTypes = new Set(sourceBlocks.map((b) => b.blockType));
  const targetBlockTypes = new Set(targetBlocks.map((b) => b.blockType));

  const blocksOnlyInSource = sourceBlocks.filter((b) => !targetBlockTypes.has(b.blockType));
  const blocksOnlyInTarget = targetBlocks.filter((b) => !sourceBlockTypes.has(b.blockType));

  return {
    linksOnlyInSource,
    linksOnlyInTarget,
    linksInBoth,
    blocksOnlyInSource,
    blocksOnlyInTarget,
    inSync:
      linksOnlyInSource.length === 0 &&
      linksOnlyInTarget.length === 0 &&
      blocksOnlyInSource.length === 0 &&
      blocksOnlyInTarget.length === 0,
  };
}
