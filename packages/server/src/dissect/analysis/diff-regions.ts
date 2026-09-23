import type { DiffBlockDissection } from "@getpaseo/protocol/dissect";
import { parseDiff, type DiffHunk } from "../../server/utils/diff-highlighter.js";

export interface DiffChangeRegion {
  id: string;
  path: string;
  oldStartLine?: number;
  oldEndLine?: number;
  newStartLine?: number;
  newEndLine?: number;
  patch: string;
}

interface OpenRegion {
  oldLines: number[];
  newLines: number[];
  patch: string[];
}

interface RawRegionExplanation {
  id: string;
  path: string;
  title: string;
  summary: string;
  whyItChanged: string;
  effect: string;
  conceptKeys: string[];
}

/** One region per contiguous run of added/removed lines; context splits regions. */
export function extractDiffChangeRegions(unifiedDiff: string): DiffChangeRegion[] {
  const regions: DiffChangeRegion[] = [];
  let nextIndex = 1;
  for (const file of parseDiff(unifiedDiff)) {
    for (const span of changeSpansFromHunks(file.hunks)) {
      regions.push({
        id: `r${nextIndex}`,
        path: file.path,
        ...span,
      });
      nextIndex += 1;
    }
  }
  return regions;
}

export function renderDiffChangeRegions(regions: readonly DiffChangeRegion[]): string {
  return regions
    .map((region) => {
      const oldRange =
        region.oldStartLine !== undefined && region.oldEndLine !== undefined
          ? `old ${region.oldStartLine}-${region.oldEndLine}`
          : "old none";
      const newRange =
        region.newStartLine !== undefined && region.newEndLine !== undefined
          ? `new ${region.newStartLine}-${region.newEndLine}`
          : "new none";
      return `### ${region.id}  ${region.path}  (${oldRange}; ${newRange})\n${region.patch}`;
    })
    .join("\n\n");
}

export function boundRenderedRegions(rendered: string, maxBytes: number): string {
  if (Buffer.byteLength(rendered, "utf8") <= maxBytes) return rendered;
  const slice = Buffer.from(rendered, "utf8").subarray(0, maxBytes).toString("utf8");
  return `${slice}\n[... later change regions omitted; explain only the regions shown ...]`;
}

/** Keep the region's exact +/- line ranges; take explanation text from the matching LLM block. */
export function attachExplanationsToRegions(input: {
  regions: readonly DiffChangeRegion[];
  explanations: readonly RawRegionExplanation[];
}): DiffBlockDissection[] {
  const regionIds = new Set(input.regions.map((region) => region.id));
  const byId = new Map<string, RawRegionExplanation>();
  const leftovers: RawRegionExplanation[] = [];
  for (const explanation of input.explanations) {
    if (regionIds.has(explanation.id) && !byId.has(explanation.id)) {
      byId.set(explanation.id, explanation);
    } else {
      leftovers.push(explanation);
    }
  }
  const blocks: DiffBlockDissection[] = [];
  for (const region of input.regions) {
    const explanation = byId.get(region.id) ?? takeLeftoverForPath(region.path, leftovers);
    if (!explanation) continue;
    blocks.push({
      id: region.id,
      path: region.path,
      title: explanation.title,
      summary: explanation.summary,
      whyItChanged: explanation.whyItChanged,
      effect: explanation.effect,
      conceptKeys: explanation.conceptKeys,
      oldStartLine: region.oldStartLine,
      oldEndLine: region.oldEndLine,
      newStartLine: region.newStartLine,
      newEndLine: region.newEndLine,
    });
  }
  return blocks;
}

interface ChangeSpan {
  oldStartLine?: number;
  oldEndLine?: number;
  newStartLine?: number;
  newEndLine?: number;
  patch: string;
}

function changeSpansFromHunks(hunks: readonly DiffHunk[]): ChangeSpan[] {
  const spans: ChangeSpan[] = [];
  for (const hunk of hunks) {
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
        if (!current) current = { oldLines: [], newLines: [], patch: [] };
        current.oldLines.push(oldLine);
        current.patch.push(`-${line.content}`);
        oldLine += 1;
        continue;
      }
      if (line.type === "add") {
        if (!current) current = { oldLines: [], newLines: [], patch: [] };
        current.newLines.push(newLine);
        current.patch.push(`+${line.content}`);
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

function takeLeftoverForPath(
  path: string,
  leftovers: RawRegionExplanation[],
): RawRegionExplanation | undefined {
  const samePath = leftovers.findIndex((entry) => entry.path === path);
  if (samePath >= 0) return leftovers.splice(samePath, 1)[0];
  return leftovers.shift();
}

function spanFromOpenRegion(current: OpenRegion): ChangeSpan | null {
  if (current.oldLines.length === 0 && current.newLines.length === 0) return null;
  return {
    oldStartLine: current.oldLines[0],
    oldEndLine: current.oldLines[current.oldLines.length - 1],
    newStartLine: current.newLines[0],
    newEndLine: current.newLines[current.newLines.length - 1],
    patch: current.patch.join("\n"),
  };
}
