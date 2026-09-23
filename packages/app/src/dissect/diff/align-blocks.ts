import type { DiffBlockDissection } from "@getpaseo/protocol/dissect";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";

export interface DiffChangeSpan {
  oldStartLine?: number;
  oldEndLine?: number;
  newStartLine?: number;
  newEndLine?: number;
}

interface OpenRegion {
  oldLines: number[];
  newLines: number[];
}

/** Contiguous added/removed islands in a parsed snapshot diff. Context splits islands. */
export function changeSpansFromParsedFile(file: ParsedDiffFile): DiffChangeSpan[] {
  const spans: DiffChangeSpan[] = [];
  for (const hunk of file.hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    let current: OpenRegion | null = null;

    function flush(): void {
      if (!current) return;
      const span = spanFromOpenRegion(current);
      if (span) spans.push(span);
      current = null;
    }

    for (const line of hunk.lines) {
      if (line.type === "header") continue;
      if (line.type === "remove") {
        if (!current) current = { oldLines: [], newLines: [] };
        current.oldLines.push(oldLine);
        oldLine += 1;
        continue;
      }
      if (line.type === "add") {
        if (!current) current = { oldLines: [], newLines: [] };
        current.newLines.push(newLine);
        newLine += 1;
        continue;
      }
      flush();
      oldLine += 1;
      newLine += 1;
    }
    flush();
  }
  return spans;
}

/**
 * Pin stored block explanations onto the exact +/- islands in the displayed
 * snapshot diff. One stored block may cover several islands until a fresh
 * Dissect Diff rewrite assigns one explanation per island.
 */
export function alignDiffBlocksToParsedFile(
  blocks: readonly DiffBlockDissection[],
  file: ParsedDiffFile,
): DiffBlockDissection[] {
  const spans = changeSpansFromParsedFile(file);
  if (spans.length === 0) return [];
  return spans.flatMap((span, index) => {
    const source = blocks.find((block) => blockOverlapsSpan(block, span)) ?? blocks[index];
    if (!source) return [];
    return [
      {
        ...source,
        id: `${source.id}:${index}`,
        oldStartLine: span.oldStartLine,
        oldEndLine: span.oldEndLine,
        newStartLine: span.newStartLine,
        newEndLine: span.newEndLine,
      },
    ];
  });
}

function blockOverlapsSpan(block: DiffBlockDissection, span: DiffChangeSpan): boolean {
  const hasRange = block.oldStartLine !== undefined || block.newStartLine !== undefined;
  if (!hasRange) return true;
  if (rangesOverlap(block.newStartLine, block.newEndLine, span.newStartLine, span.newEndLine)) {
    return true;
  }
  return rangesOverlap(block.oldStartLine, block.oldEndLine, span.oldStartLine, span.oldEndLine);
}

function rangesOverlap(
  start: number | undefined,
  end: number | undefined,
  otherStart: number | undefined,
  otherEnd: number | undefined,
): boolean {
  if (start === undefined || end === undefined) return false;
  if (otherStart === undefined || otherEnd === undefined) return false;
  return start <= otherEnd && otherStart <= end;
}

function spanFromOpenRegion(current: OpenRegion): DiffChangeSpan | null {
  if (current.oldLines.length === 0 && current.newLines.length === 0) return null;
  return {
    oldStartLine: current.oldLines[0],
    oldEndLine: current.oldLines[current.oldLines.length - 1],
    newStartLine: current.newLines[0],
    newEndLine: current.newLines[current.newLines.length - 1],
  };
}
