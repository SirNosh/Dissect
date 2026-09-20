import { z } from "zod";
import {
  ArchitectureGraphSchema,
  CodeBlockDissectionSchema,
  ConceptReferenceSchema,
  DiffBlockDissectionSchema,
} from "@getpaseo/protocol/dissect";
import type { ArchitectureGraph } from "@getpaseo/protocol/dissect";

// ============================================================================
// Raw LLM output schemas (validated before results enter the application)
// ============================================================================

export const RawFileSummariesSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      role: z.string().catch(""),
      summary: z.string(),
      exports: z.array(z.string()).catch([]),
      imports: z.array(z.string()).catch([]),
      importantSymbols: z.array(z.string()).catch([]),
      conceptKeys: z.array(z.string()).catch([]),
    }),
  ),
});

export const RawArchitectureSchema = z.object({
  summary: z.string(),
  graph: ArchitectureGraphSchema,
  folders: z.array(
    z.object({
      path: z.string(),
      role: z.string().catch(""),
      summary: z.string(),
      conceptKeys: z.array(z.string()).catch([]),
    }),
  ),
  concepts: z.array(ConceptReferenceSchema).catch([]),
});

export const RawFileDissectionSchema = z.object({
  summary: z.string(),
  role: z.string().catch(""),
  concepts: z.array(ConceptReferenceSchema).catch([]),
  blocks: z.array(CodeBlockDissectionSchema),
});

export const RawDiffDissectionSchema = z.object({
  summary: z.string(),
  architectureImpact: z.array(z.string()).catch([]),
  changedFolders: z
    .array(
      z.object({
        path: z.string(),
        summary: z.string(),
        files: z.array(z.string()).catch([]),
      }),
    )
    .catch([]),
  changedFiles: z.array(
    z.object({
      path: z.string(),
      status: z.enum(["added", "modified", "deleted", "renamed"]).catch("modified"),
      summary: z.string(),
      blocks: z.array(DiffBlockDissectionSchema).catch([]),
    }),
  ),
  concepts: z.array(ConceptReferenceSchema).catch([]),
});

export const RawContextAnswerSchema = z.object({
  markdown: z.string(),
  references: z
    .array(
      z.object({
        path: z.string(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      }),
    )
    .catch([]),
  concepts: z.array(ConceptReferenceSchema).catch([]),
});

// ============================================================================
// Local validation helpers
// ============================================================================

/** Normalize an LLM-supplied node id into a Mermaid-safe identifier. */
export function sanitizeGraphNodeId(id: string): string | null {
  const cleaned = id.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return null;
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `n_${cleaned}`;
}

/**
 * Enforce that graph nodes map to real repository paths and that edges
 * reference surviving nodes. Invalid entries are discarded, never guessed.
 */
export function sanitizeArchitectureGraph(
  graph: ArchitectureGraph,
  repositoryFolders: ReadonlySet<string>,
  repositoryFiles: ReadonlySet<string> = new Set(),
): ArchitectureGraph {
  const allowedPaths = new Set<string>([".", ...repositoryFolders, ...repositoryFiles]);
  const idMap = new Map<string, string>();
  const seenIds = new Set<string>();
  const nodes: ArchitectureGraph["nodes"] = [];
  for (const node of graph.nodes) {
    const id = sanitizeGraphNodeId(node.id);
    if (!id || seenIds.has(id)) continue;
    if (node.kind === "external") {
      seenIds.add(id);
      idMap.set(node.id, id);
      nodes.push({ ...node, id, path: null });
      continue;
    }
    const normalized = node.path?.replace(/^\.\//, "").replace(/\/+$/, "") ?? "";
    if (!normalized || !allowedPaths.has(normalized)) continue;
    seenIds.add(id);
    idMap.set(node.id, id);
    nodes.push({ ...node, id, path: normalized });
  }
  const edges = graph.edges
    .map((edge) => ({
      ...edge,
      from: idMap.get(edge.from) ?? "",
      to: idMap.get(edge.to) ?? "",
    }))
    .filter((edge) => edge.from.length > 0 && edge.to.length > 0 && edge.from !== edge.to);
  return { nodes, edges };
}

/** Keep only blocks with valid, non-overlapping line ranges. */
export function validateBlockRanges<T extends { startLine: number; endLine: number }>(
  blocks: T[],
  lineCount: number,
): T[] {
  const valid = blocks
    .filter(
      (block) =>
        block.startLine >= 1 && block.startLine <= block.endLine && block.endLine <= lineCount,
    )
    .sort((a, b) => a.startLine - b.startLine);
  const result: T[] = [];
  let lastEnd = 0;
  for (const block of valid) {
    if (block.startLine <= lastEnd) continue;
    result.push(block);
    lastEnd = block.endLine;
  }
  return result;
}
