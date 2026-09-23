import type { FileDissection } from "@getpaseo/protocol/dissect";
import type { RetrievedKnowledge } from "../knowledge/retrieve.js";
import type { DissectTextProvider } from "../providers/provider.js";
import { callStructured } from "../providers/provider.js";
import { buildFileDissectionPrompt } from "../providers/prompts.js";
import { readRepositoryFile } from "../repository/inventory.js";
import { MAX_ANALYZABLE_FILE_BYTES } from "../repository/filters.js";
import { sha256Hex } from "../repository/hash.js";
import { RawFileDissectionSchema, validateBlockRanges } from "./schemas.js";

export function numberSourceLines(content: string): { numbered: string; lineCount: number } {
  const lines = content.split("\n");
  const numbered = lines.map((line, index) => `${index + 1} | ${line}`).join("\n");
  return { numbered, lineCount: lines.length };
}

/**
 * Lazy per-file dissection with exact line-range validation. If the file
 * content changes while the model is analyzing it, the result is discarded so
 * a stale explanation never attaches to new code.
 */
export async function analyzeFile(input: {
  cwd: string;
  path: string;
  provider: DissectTextProvider;
  knowledge: RetrievedKnowledge;
}): Promise<FileDissection> {
  const read = await readRepositoryFile(input.cwd, input.path, MAX_ANALYZABLE_FILE_BYTES);
  if (!read) {
    throw new Error(`File ${input.path} could not be read for analysis.`);
  }
  if (read.truncated) {
    throw new Error(`File ${input.path} is too large for block analysis.`);
  }
  const contentHash = sha256Hex(read.content);
  const { numbered, lineCount } = numberSourceLines(read.content);

  const prompt = buildFileDissectionPrompt({
    path: input.path,
    numberedContent: numbered,
    lineCount,
    knowledge: input.knowledge,
  });
  const raw = await callStructured(input.provider, RawFileDissectionSchema, prompt);

  // Discard the result if the file changed underneath the analysis.
  const verify = await readRepositoryFile(input.cwd, input.path, MAX_ANALYZABLE_FILE_BYTES);
  if (!verify || sha256Hex(verify.content) !== contentHash) {
    throw new Error(
      `Repository contents changed while ${input.path} was being analyzed. Dissect the file again.`,
    );
  }

  return {
    path: input.path,
    summary: raw.summary,
    role: raw.role,
    contentHash,
    concepts: raw.concepts,
    blocks: validateBlockRanges(raw.blocks, lineCount),
  };
}
