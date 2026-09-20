import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { highlightDiffLines } from "@/utils/diff-highlight";
import type { DiffLine } from "@/utils/tool-call-parsers";

function usesDiffPathPrefixes(oldPath: string, newPath: string): boolean {
  return oldPath.startsWith("a/") && newPath.startsWith("b/");
}

function extractPathFromMetadata(lines: string[], prefix: "--- " | "+++ "): string | null {
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  if (!line) return null;
  const filePath = line.slice(prefix.length).replace(/\t.*$/, "").trimEnd();
  return filePath === "/dev/null" ? null : filePath;
}

function stripDiffPrefix(filePath: string): string {
  if (filePath.startsWith("a/") || filePath.startsWith("b/")) return filePath.slice(2);
  return filePath;
}

function extractPathFromDiffHeader(lines: string[]): string {
  const firstLine = lines[0] ?? "";
  const prefixedPathMatch = firstLine.match(/^a\/(.+) b\/(.+)$/);
  if (prefixedPathMatch) return prefixedPathMatch[2];
  const metadataPath =
    extractPathFromMetadata(lines, "+++ ") ?? extractPathFromMetadata(lines, "--- ");
  if (metadataPath) return stripDiffPrefix(metadataPath);
  const pathMatch = firstLine.match(/^(\S+)\s+(\S+)$/);
  if (pathMatch) {
    const [, oldPath, newPath] = pathMatch;
    const filePath = newPath === "/dev/null" ? oldPath : newPath;
    return usesDiffPathPrefixes(oldPath, newPath) ? filePath.slice(2) : filePath;
  }
  return "unknown";
}

function isMetadataLine(line: string): boolean {
  return (
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file mode") ||
    line.startsWith("deleted file mode")
  );
}

function parseHunkHeader(line: string): ParsedDiffFile["hunks"][number] | null {
  const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!hunkMatch) return null;
  return {
    oldStart: parseInt(hunkMatch[1], 10),
    oldCount: parseInt(hunkMatch[2] ?? "1", 10),
    newStart: parseInt(hunkMatch[3], 10),
    newCount: parseInt(hunkMatch[4] ?? "1", 10),
    lines: [{ type: "header", content: line.match(/^(@@ .+? @@)/)?.[1] ?? line }],
  };
}

function parseSectionBody(
  lines: string[],
): Pick<ParsedDiffFile, "hunks" | "additions" | "deletions"> {
  const hunks: ParsedDiffFile["hunks"] = [];
  let currentHunk: ParsedDiffFile["hunks"][number] | null = null;
  let additions = 0;
  let deletions = 0;

  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (isMetadataLine(line)) continue;
    const newHunk = parseHunkHeader(line);
    if (newHunk) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = newHunk;
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith("+")) {
      currentHunk.lines.push({ type: "add", content: line.slice(1) });
      additions++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ type: "remove", content: line.slice(1) });
      deletions++;
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({ type: "context", content: line.slice(1) });
    } else if (line.length > 0 && !line.startsWith("\\")) {
      currentHunk.lines.push({ type: "context", content: line });
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return { hunks, additions, deletions };
}

function parseDiffFiles(diffText: string): ParsedDiffFile[] {
  if (!diffText.trim()) return [];
  const files: ParsedDiffFile[] = [];
  for (const section of diffText.split(/^diff --git /m).filter(Boolean)) {
    const lines = section.split("\n");
    const isNew = section.includes("new file mode") || section.includes("--- /dev/null");
    const isDeleted = section.includes("deleted file mode") || section.includes("+++ /dev/null");
    const { hunks, additions, deletions } = parseSectionBody(lines);
    files.push({
      path: extractPathFromDiffHeader(lines),
      isNew,
      isDeleted,
      additions,
      deletions,
      hunks,
    });
  }
  return files;
}

function highlightParsedDiffFile(file: ParsedDiffFile): ParsedDiffFile {
  const flat = file.hunks.flatMap((hunk) => hunk.lines);
  const highlighted = highlightDiffLines(flat as DiffLine[], file.path);
  let offset = 0;
  return {
    ...file,
    hunks: file.hunks.map((hunk) => {
      const next = highlighted.slice(offset, offset + hunk.lines.length);
      offset += hunk.lines.length;
      return {
        ...hunk,
        lines: next.map((line, index) => {
          const type = hunk.lines[index]?.type ?? line.type;
          const content = hunk.lines[index]?.content ?? line.content;
          if (line.tokens) return { type, content, tokens: line.tokens };
          return { type, content };
        }),
      };
    }),
  };
}

/** Parse a snapshot-to-snapshot unified diff for one workspace path. */
export function parseSnapshotUnifiedDiff(input: {
  path: string;
  unifiedDiff: string;
}): ParsedDiffFile | null {
  const files = parseDiffFiles(input.unifiedDiff);
  const file = files.find((entry) => entry.path === input.path) ?? files[0] ?? null;
  if (!file) return null;
  return highlightParsedDiffFile({ ...file, path: input.path });
}
