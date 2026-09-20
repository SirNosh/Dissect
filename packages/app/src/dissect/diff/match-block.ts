import type { DiffBlockDissection } from "@getpaseo/protocol/dissect";

export interface MatchedDiffBlock {
  block: DiffBlockDissection;
  index: number;
}

/** Find the Dissect change-block that covers a painted diff cell. */
export function matchDissectDiffBlock(
  blocks: readonly DiffBlockDissection[],
  side: "old" | "new",
  lineNumber: number | null,
): MatchedDiffBlock | null {
  if (lineNumber === null) return null;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (side === "new") {
      if (
        block.newStartLine !== undefined &&
        block.newEndLine !== undefined &&
        lineNumber >= block.newStartLine &&
        lineNumber <= block.newEndLine
      ) {
        return { block, index };
      }
    } else if (
      block.oldStartLine !== undefined &&
      block.oldEndLine !== undefined &&
      lineNumber >= block.oldStartLine &&
      lineNumber <= block.oldEndLine
    ) {
      return { block, index };
    }
  }
  return null;
}
