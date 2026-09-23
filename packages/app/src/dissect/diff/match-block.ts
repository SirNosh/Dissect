import type { DiffBlockDissection } from "@getpaseo/protocol/dissect";

export interface MatchedDiffBlock {
  block: DiffBlockDissection;
  index: number;
}

export interface DiffBlockMatchCell {
  side: "old" | "new";
  lineNumber: number | null;
  type: string;
}

/** Find the Dissect change-block that covers a painted added or removed diff cell. */
export function matchDissectDiffBlock(
  blocks: readonly DiffBlockDissection[],
  cell: DiffBlockMatchCell,
): MatchedDiffBlock | null {
  if (cell.type !== "add" && cell.type !== "remove") return null;
  if (cell.lineNumber === null) return null;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (cell.side === "new") {
      if (
        block.newStartLine !== undefined &&
        block.newEndLine !== undefined &&
        cell.lineNumber >= block.newStartLine &&
        cell.lineNumber <= block.newEndLine
      ) {
        return { block, index };
      }
    } else if (
      block.oldStartLine !== undefined &&
      block.oldEndLine !== undefined &&
      cell.lineNumber >= block.oldStartLine &&
      cell.lineNumber <= block.oldEndLine
    ) {
      return { block, index };
    }
  }
  return null;
}
