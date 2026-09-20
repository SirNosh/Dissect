import { randomUUID } from "node:crypto";
import type { DiffDissection, DissectKnowledgeState } from "@getpaseo/protocol/dissect";
import type { DissectTextProvider } from "../providers/provider.js";
import { callStructured } from "../providers/provider.js";
import { buildDiffDissectionPrompt } from "../providers/prompts.js";
import {
  listChangedFilesBetweenSnapshots,
  unifiedDiffBetweenSnapshots,
  type SnapshotChangedFile,
} from "../snapshot/diff-between-snapshots.js";
import { isAnalyzableSourcePath } from "../repository/filters.js";
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

function boundDiff(diff: string): string {
  if (Buffer.byteLength(diff, "utf8") <= MAX_DIFF_PROMPT_BYTES) return diff;
  const slice = Buffer.from(diff, "utf8").subarray(0, MAX_DIFF_PROMPT_BYTES).toString("utf8");
  return `${slice}\n[... diff truncated for analysis; explain only what is shown ...]`;
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
  knowledge: DissectKnowledgeState;
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

  const prompt = buildDiffDissectionPrompt({
    fileStatuses: renderStatuses(changed),
    unifiedDiff: boundDiff(unified),
    knowledge: input.knowledge,
  });
  const raw = await callStructured(input.provider, RawDiffDissectionSchema, prompt);

  const changedByPath = new Map(changed.map((file) => [file.path, file]));
  const changedFiles = raw.changedFiles
    .filter((file) => changedByPath.has(file.path))
    .map((file) => {
      const status = changedByPath.get(file.path)!.status;
      const blocks = file.blocks.filter((block) => {
        if (block.path !== file.path) return false;
        const oldRangeValid =
          block.oldStartLine === undefined ||
          block.oldEndLine === undefined ||
          block.oldStartLine <= block.oldEndLine;
        const newRangeValid =
          block.newStartLine === undefined ||
          block.newEndLine === undefined ||
          block.newStartLine <= block.newEndLine;
        return oldRangeValid && newRangeValid;
      });
      return {
        path: file.path,
        status,
        summary: file.summary,
        blocks,
      };
    });

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
