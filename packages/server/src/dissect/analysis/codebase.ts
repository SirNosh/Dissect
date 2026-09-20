import { randomUUID } from "node:crypto";
import type pino from "pino";
import type {
  CodebaseDissection,
  DissectFileSummary,
  DissectFolderSummary,
  DissectKnowledgeState,
} from "@getpaseo/protocol/dissect";
import type { DissectTextProvider } from "../providers/provider.js";
import { callStructured } from "../providers/provider.js";
import { buildArchitecturePrompt, buildFileSummariesPrompt } from "../providers/prompts.js";
import {
  collectRepositoryInventory,
  readRepositoryFile,
  type RepositoryInventory,
} from "../repository/inventory.js";
import { MAX_SUMMARY_CONTENT_BYTES } from "../repository/filters.js";
import {
  RawArchitectureSchema,
  RawFileSummariesSchema,
  sanitizeArchitectureGraph,
} from "./schemas.js";

export interface CodebaseProgressEvent {
  stage: "snapshot" | "inventory" | "file_summaries" | "architecture" | "done";
  detail: string | null;
  completed: number | null;
  total: number | null;
}

const SUMMARY_BATCH_MAX_FILES = 8;
const SUMMARY_BATCH_MAX_BYTES = 48_000;
const SUMMARY_CONCURRENCY = 3;
const MAX_FILES_ANALYZED = 400;
const MAX_TREE_LINES = 600;

interface SummaryBatch {
  files: Array<{ path: string; language: string | null; content: string; truncated: boolean }>;
}

async function buildSummaryBatches(
  cwd: string,
  inventory: RepositoryInventory,
): Promise<SummaryBatch[]> {
  const analyzable = inventory.files.filter((file) => file.analyzable).slice(0, MAX_FILES_ANALYZED);
  const batches: SummaryBatch[] = [];
  let current: SummaryBatch = { files: [] };
  let currentBytes = 0;
  for (const entry of analyzable) {
    const read = await readRepositoryFile(cwd, entry.path, MAX_SUMMARY_CONTENT_BYTES);
    if (!read) continue;
    const size = Buffer.byteLength(read.content, "utf8");
    if (
      current.files.length >= SUMMARY_BATCH_MAX_FILES ||
      (current.files.length > 0 && currentBytes + size > SUMMARY_BATCH_MAX_BYTES)
    ) {
      batches.push(current);
      current = { files: [] };
      currentBytes = 0;
    }
    current.files.push({
      path: entry.path,
      language: entry.language,
      content: read.content,
      truncated: read.truncated,
    });
    currentBytes += size;
  }
  if (current.files.length > 0) batches.push(current);
  return batches;
}

function renderTree(inventory: RepositoryInventory): string {
  const lines: string[] = [];
  for (const folder of inventory.folders) {
    lines.push(`${folder}/`);
  }
  for (const file of inventory.files) {
    lines.push(file.path);
  }
  if (lines.length > MAX_TREE_LINES) {
    const shown = lines.slice(0, MAX_TREE_LINES);
    shown.push(`[... ${lines.length - MAX_TREE_LINES} more entries omitted ...]`);
    return shown.join("\n");
  }
  return lines.join("\n");
}

function renderSummariesForArchitecture(summaries: DissectFileSummary[]): string {
  return summaries
    .map(
      (summary) =>
        `${summary.path} [${summary.language ?? "unknown"}] — ${summary.role}: ${summary.summary}` +
        (summary.exports.length > 0 ? ` Exports: ${summary.exports.slice(0, 8).join(", ")}.` : "") +
        (summary.imports.length > 0 ? ` Imports: ${summary.imports.slice(0, 8).join(", ")}.` : ""),
    )
    .join("\n");
}

function synthesizeFolderSummaries(
  inventory: RepositoryInventory,
  fileSummaries: DissectFileSummary[],
  llmFolders: Array<{ path: string; role: string; summary: string; conceptKeys: string[] }>,
): DissectFolderSummary[] {
  const filesByFolder = new Map<string, string[]>();
  const childrenByFolder = new Map<string, Set<string>>();
  for (const file of inventory.files) {
    const slash = file.path.lastIndexOf("/");
    const folder = slash === -1 ? "." : file.path.slice(0, slash);
    const bucket = filesByFolder.get(folder) ?? [];
    bucket.push(file.path);
    filesByFolder.set(folder, bucket);
  }
  for (const folder of inventory.folders) {
    const slash = folder.lastIndexOf("/");
    const parent = slash === -1 ? "." : folder.slice(0, slash);
    const bucket = childrenByFolder.get(parent) ?? new Set<string>();
    bucket.add(folder);
    childrenByFolder.set(parent, bucket);
  }

  const summaryByPath = new Map(fileSummaries.map((summary) => [summary.path, summary]));
  const llmByPath = new Map(
    llmFolders.map((folder) => [folder.path.replace(/^\.\//, "").replace(/\/+$/, ""), folder]),
  );
  const allFolders = new Set<string>(["."]);
  for (const folder of inventory.folders) allFolders.add(folder);

  const result: DissectFolderSummary[] = [];
  for (const folder of [...allFolders].sort()) {
    const files = (filesByFolder.get(folder) ?? []).sort();
    const childFolders = [...(childrenByFolder.get(folder) ?? [])].sort();
    if (files.length === 0 && childFolders.length === 0) continue;
    const llm = llmByPath.get(folder);
    const conceptKeys = llm?.conceptKeys ?? [
      ...new Set(files.flatMap((file) => summaryByPath.get(file)?.conceptKeys ?? [])),
    ];
    result.push({
      path: folder,
      role: llm?.role ?? "",
      summary: llm?.summary ?? "",
      files,
      childFolders,
      conceptKeys: conceptKeys.slice(0, 12),
    });
  }
  return result;
}

/**
 * Full-codebase dissection: hierarchical collection (inventory, batched file
 * summaries, architecture synthesis) with real progress events. Individual
 * batch failures never crash the run.
 */
export async function analyzeCodebase(input: {
  cwd: string;
  snapshotId: string;
  projectId: string;
  provider: DissectTextProvider;
  knowledge: DissectKnowledgeState;
  logger: pino.Logger;
  onProgress: (event: CodebaseProgressEvent) => void;
}): Promise<CodebaseDissection> {
  const { cwd, provider, knowledge, logger, onProgress } = input;

  onProgress({ stage: "inventory", detail: null, completed: null, total: null });
  const inventory = await collectRepositoryInventory(cwd);
  if (inventory.files.length === 0) {
    throw new Error("The workspace has no local files to dissect.");
  }

  const batches = await buildSummaryBatches(cwd, inventory);
  const totalFiles = batches.reduce((count, batch) => count + batch.files.length, 0);
  let completedFiles = 0;
  onProgress({ stage: "file_summaries", detail: null, completed: 0, total: totalFiles });

  const allSummaries: DissectFileSummary[] = [];
  const languageByPath = new Map(inventory.files.map((file) => [file.path, file.language]));
  const validPaths = new Set(inventory.files.map((file) => file.path));

  let nextBatch = 0;
  const workers = Array.from(
    { length: Math.min(SUMMARY_CONCURRENCY, batches.length) },
    async () => {
      while (nextBatch < batches.length) {
        const batch = batches[nextBatch++];
        try {
          const prompt = buildFileSummariesPrompt({ files: batch.files, knowledge });
          const raw = await callStructured(provider, RawFileSummariesSchema, prompt);
          for (const summary of raw.files) {
            if (!validPaths.has(summary.path)) continue;
            allSummaries.push({
              ...summary,
              language: languageByPath.get(summary.path) ?? null,
            });
          }
        } catch (error) {
          logger.warn(
            { err: error, files: batch.files.map((file) => file.path) },
            "Dissect file-summary batch failed; continuing without it",
          );
        }
        completedFiles += batch.files.length;
        onProgress({
          stage: "file_summaries",
          detail: null,
          completed: completedFiles,
          total: totalFiles,
        });
      }
    },
  );
  await Promise.all(workers);

  if (allSummaries.length === 0) {
    throw new Error("No file summaries could be generated; the analysis model may be failing.");
  }

  onProgress({ stage: "architecture", detail: null, completed: null, total: null });
  const architecturePrompt = buildArchitecturePrompt({
    tree: renderTree(inventory),
    fileSummaries: renderSummariesForArchitecture(allSummaries),
    knowledge,
  });
  const architecture = await callStructured(provider, RawArchitectureSchema, architecturePrompt);

  const folderSet = new Set(inventory.folders);
  const fileSet = new Set(inventory.files.map((file) => file.path));
  const graph = sanitizeArchitectureGraph(architecture.graph, folderSet, fileSet);
  if (graph.nodes.length === 0) {
    throw new Error("The architecture analysis did not produce any valid graph nodes.");
  }

  const folders = synthesizeFolderSummaries(inventory, allSummaries, architecture.folders);

  return {
    runId: randomUUID(),
    projectId: input.projectId,
    workspaceId: cwd,
    snapshotId: input.snapshotId,
    generatedAt: new Date().toISOString(),
    summary: architecture.summary,
    graph,
    folders,
    files: allSummaries.sort((a, b) => a.path.localeCompare(b.path)),
    concepts: architecture.concepts,
  };
}
