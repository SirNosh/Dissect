import { randomUUID } from "node:crypto";
import type { DiffBlockDissection, DiffDissection } from "@getpaseo/protocol/dissect";
import type { KnowledgeRetriever } from "../knowledge/retrieve.js";
import type { DissectTextProvider } from "../providers/provider.js";
import { callStructured } from "../providers/provider.js";
import { buildDiffDissectionPrompt } from "../providers/prompts.js";
import {
  listChangedFilesBetweenSnapshots,
  unifiedDiffBetweenSnapshots,
  type SnapshotChangedFile,
} from "../snapshot/diff-between-snapshots.js";
import { isAnalyzableSourcePath } from "../repository/filters.js";
import {
  attachExplanationsToRegions,
  boundRenderedRegions,
  extractDiffChangeRegions,
  renderDiffChangeRegions,
} from "./diff-regions.js";
import { RawDiffDissectionSchema } from "./schemas.js";

const MAX_DIFF_PROMPT_BYTES = 160_000;

function renderStatuses(changed: SnapshotChangedFile[]): string {
  return changed
    .map((file) =>
      file.status === "renamed"
        ? `renamed\t${file.oldPath} -> ${file.path}`
        : `${file.status}\t${file.path}`,
    )
    .join("\n");
}

function blocksByPath(blocks: readonly DiffBlockDissection[]): Map<string, DiffBlockDissection[]> {
  const grouped = new Map<string, DiffBlockDissection[]>();
  for (const block of blocks) {
    const existing = grouped.get(block.path);
    if (existing) {
      existing.push(block);
    } else {
      grouped.set(block.path, [block]);
    }
  }
  return grouped;
}

/**
 * Exact snapshot-to-snapshot diff dissection. Receives only the file delta
 * from the latest coding-agent turn — never a transcript.
 */
export async function analyzeDiff(input: {
  cwd: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  provider: DissectTextProvider;
  priorConceptKeys: ReadonlyMap<string, readonly string[]>;
  knowledge: KnowledgeRetriever;
}): Promise<DiffDissection> {
  const changed = await listChangedFilesBetweenSnapshots(
    input.cwd,
    input.fromSnapshotId,
    input.toSnapshotId,
  );
  if (changed.length === 0) {
    throw new Error("No changes were found between the snapshots.");
  }

  // Only source-relevant paths get diff content in the prompt; the rest are
  // listed by status so the model still knows they changed.
  const analyzablePaths = changed
    .filter((file) => isAnalyzableSourcePath(file.path))
    .map((file) => file.path);
  const unified =
    analyzablePaths.length > 0
      ? await unifiedDiffBetweenSnapshots(
          input.cwd,
          input.fromSnapshotId,
          input.toSnapshotId,
          analyzablePaths,
        )
      : "";

  const regions = extractDiffChangeRegions(unified);
  const changeRegions = boundRenderedRegions(
    renderDiffChangeRegions(regions),
    MAX_DIFF_PROMPT_BYTES,
  );
  const conceptKeys = [
    ...new Set(changed.flatMap((file) => input.priorConceptKeys.get(file.path) ?? [])),
  ];
  const prompt = buildDiffDissectionPrompt({
    fileStatuses: renderStatuses(changed),
    changeRegions,
    knowledge: input.knowledge.retrieve({
      conceptKeys,
      componentPaths: changed.map((file) => file.path),
      text: changeRegions,
    }),
  });
  const raw = await callStructured(input.provider, RawDiffDissectionSchema, prompt);

  const explanations = raw.changedFiles.flatMap((file) => file.blocks);
  const attached = attachExplanationsToRegions({ regions, explanations });
  const attachedByPath = blocksByPath(attached);
  const rawByPath = new Map(raw.changedFiles.map((file) => [file.path, file]));
  const changedByPath = new Map(changed.map((file) => [file.path, file]));
  const changedFiles = changed.map((file) => ({
    path: file.path,
    status: file.status,
    summary: rawByPath.get(file.path)?.summary ?? "",
    blocks: attachedByPath.get(file.path) ?? [],
  }));

  const knownChangedPaths = new Set(changedFiles.map((file) => file.path));
  const changedFolders = raw.changedFolders
    .map((folder) => ({
      ...folder,
      files: folder.files.filter((path) => changedByPath.has(path)),
    }))
    .filter((folder) => folder.files.length > 0);

  // Every changed file must appear somewhere in the folder hierarchy.
  const filesInFolders = new Set(changedFolders.flatMap((folder) => folder.files));
  const orphaned = [...knownChangedPaths].filter((path) => !filesInFolders.has(path));
  if (orphaned.length > 0) {
    const byFolder = new Map<string, string[]>();
    for (const path of orphaned) {
      const slash = path.lastIndexOf("/");
      const folder = slash === -1 ? "." : path.slice(0, slash);
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
    }
    for (const [folder, files] of byFolder) {
      changedFolders.push({ path: folder, summary: "", files });
    }
  }

  return {
    runId: randomUUID(),
    fromSnapshotId: input.fromSnapshotId,
    toSnapshotId: input.toSnapshotId,
    generatedAt: new Date().toISOString(),
    summary: raw.summary,
    architectureImpact: raw.architectureImpact,
    changedFolders,
    changedFiles,
    concepts: raw.concepts,
  };
}
