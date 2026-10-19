/**
 * The shared-row check on configs Payload's SQL adapters can't boot, such as a
 * block that nests itself (a menu, a tree), which a MongoDB app may have.
 */

import type { Block, Field } from "payload";
import { describe, expect, it } from "vitest";
import { findDroppedSharedRows } from "../sharedRows.js";

function nestingBlock(localized: boolean): Block {
  return {
    slug: "node",
    fields: [
      { name: "label", type: "text", localized },
      { name: "children", type: "blocks", blockReferences: ["node"], blocks: [] },
    ],
  };
}

const fields: Field[] = [{ name: "nodes", type: "blocks", blockReferences: ["node"], blocks: [] }];
const stored = { nodes: [{ id: "a", blockType: "node", label: "Home" }] };
const idLess = { nodes: [{ blockType: "node", label: "Start" }] };

describe("blocks that nest themselves", () => {
  it("are checked without recursing forever", () => {
    expect(findDroppedSharedRows(fields, idLess, stored, [nestingBlock(true)])).toEqual([
      { path: "nodes", existingIds: ["a"] },
    ]);
  });

  it("let rows be replaced when nothing inside them is localized", () => {
    expect(findDroppedSharedRows(fields, idLess, stored, [nestingBlock(false)])).toEqual([]);
  });
});
