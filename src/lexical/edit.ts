/**
 * Editing a richtext field on a document.
 *
 * A caller states the change; `editRichText` owns everything it takes to land
 * it: resolving the field path, applying the edit to a copy of the tree,
 * validating the result, and writing it back. That includes the awkward cases —
 * appending to a field with no nodes to anchor to, or keeping a rejected tree
 * out of the document.
 *
 * It stays pure: the document is a plain object the caller fetched and will
 * save itself. Nothing here talks to Payload, the filesystem, or the network.
 */

import { addNode, linkText, removeNode, replaceNode, setNodeProp } from "./operations.js";
import { resolveFieldPath, setByPath } from "./field-path.js";
import { assertValidTree } from "./validate.js";
import type { LexicalNode } from "./types.js";

/**
 * A single change to a tree. Addresses come from `listNodes`: `"3"` is the
 * fourth top-level node, `"3.1"` its second child.
 */
export type RichTextEdit =
  /** Add at the end of the top level. Works on an empty field. */
  | { op: "append"; node: LexicalNode }
  /** Add at the start of the top level. Works on an empty field. */
  | { op: "prepend"; node: LexicalNode }
  | { op: "insertBefore"; address: string; node: LexicalNode }
  | { op: "insertAfter"; address: string; node: LexicalNode }
  /** Add as the first or last child of the addressed node. */
  | { op: "insertInside"; address: string; position: "start" | "end"; node: LexicalNode }
  | { op: "replace"; address: string; node: LexicalNode }
  | { op: "remove"; address: string }
  /**
   * Set one property on the addressed node. `key` may be a path into the node
   * (`"fields.buttons[0].label"`). Setting a property the node doesn't have is
   * refused unless `create` is set — a typo'd key is far more common than a
   * genuinely new one.
   */
  | { op: "setProp"; address: string; key: string; value: unknown; create?: boolean }
  /**
   * Wrap the first unlinked occurrence of `search` in `node` (a link node,
   * e.g. from `buildInternalLink`). Text inside existing links is skipped.
   */
  | { op: "linkText"; search: string; node: LexicalNode };

function applyEdit(children: LexicalNode[], edit: RichTextEdit): LexicalNode[] {
  switch (edit.op) {
    case "append":
      return addNode(children, "", "end", edit.node);
    case "prepend":
      return addNode(children, "", "start", edit.node);
    case "insertBefore":
      return addNode(children, edit.address, "before", edit.node);
    case "insertAfter":
      return addNode(children, edit.address, "after", edit.node);
    case "insertInside":
      return addNode(children, edit.address, edit.position, edit.node);
    case "replace":
      return replaceNode(children, edit.address, edit.node);
    case "remove":
      return removeNode(children, edit.address);
    case "setProp":
      return setNodeProp(children, edit.address, edit.key, edit.value, { create: edit.create });
    case "linkText":
      return linkText(children, edit.search, edit.node);
  }
}

/**
 * Apply one edit — or a batch, in order — to a richtext field and write the
 * result back into `doc`.
 *
 * `fieldPath` is the field name (`"content"`), a path into an array/group/tab
 * (`"sections.0.body"`), or a path through a lexical block by its blockType
 * (`"content.TwoColumnRichText.firstColumn"`).
 *
 * Returns the field's new children. `doc` is mutated in place — only the
 * richtext field's `children`, leaving the rest of the root and the surrounding
 * document untouched, so the caller can send the top-level field back as a
 * whole.
 *
 * All or nothing: the edits are applied to a copy, validated once, and only
 * then written. If the field can't be resolved, an address doesn't exist, or
 * the result is a tree Payload would reject, this throws `LexicalError` (with a
 * `code`) and `doc` is left exactly as it was — including when the second of
 * three edits is the one that fails.
 *
 * Addresses refer to the tree as of the preceding edits, so a batch reads like
 * a sequence of steps: remove node "0", then "1" is what "2" was.
 */
export function editRichText(
  doc: Record<string, unknown>,
  fieldPath: string,
  edit: RichTextEdit | RichTextEdit[],
): LexicalNode[] {
  const edits = Array.isArray(edit) ? edit : [edit];
  let children = resolveFieldPath(doc, fieldPath);
  for (const step of edits) {
    children = applyEdit(children, step);
  }
  // Validate before writing: a rejected edit must leave the document as it was.
  assertValidTree(children);
  setByPath(doc, fieldPath, children);
  return children;
}
