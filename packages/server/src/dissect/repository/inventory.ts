import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { runGitCommand } from "../../utils/run-git-command.js";
import { detectLanguage } from "./language.js";
import {
  isAnalyzableSourcePath,
  looksBinary,
  MAX_ANALYZABLE_FILE_BYTES,
  shouldSkipInventoryDirectory,
} from "./filters.js";

export interface RepositoryFileEntry {
  /** Repository-relative path with forward slashes. */
  path: string;
  size: number;
  language: string | null;
  /** Whether the file contents may be sent to the analysis model. */
  analyzable: boolean;
}

export interface RepositoryInventory {
  files: RepositoryFileEntry[];
  /** Every directory (repository-relative) that contains at least one file. */
  folders: string[];
}

const READ_ONLY_GIT_ENV = { GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };

function splitZeroTerminated(stdout: string): string[] {
  return stdout.split("\0").filter((entry) => entry.length > 0);
}

function toPosixRelative(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

/**
 * Enumerate files that actually exist on disk in this workspace. Git is used
 * only to honor ignore rules; the inventory never lists index-only or remote
 * paths that are not checked out locally.
 */
export async function collectRepositoryInventory(cwd: string): Promise<RepositoryInventory> {
  const discovered: string[] = [];
  await walkLocalFiles(cwd, "", discovered);
  const ignored = await gitIgnoredRelativePaths(cwd, discovered);
  const files: RepositoryFileEntry[] = [];
  const folders = new Set<string>();

  for (const relativePath of discovered.sort()) {
    if (ignored.has(relativePath)) continue;
    const fileName = relativePath.slice(relativePath.lastIndexOf("/") + 1);
    if (fileName.startsWith(".")) continue;
    const absolute = path.join(cwd, relativePath);
    let size: number;
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) continue;
      size = stat.size;
    } catch {
      continue;
    }
    const analyzable =
      isAnalyzableSourcePath(relativePath) && size > 0 && size <= MAX_ANALYZABLE_FILE_BYTES;
    files.push({
      path: relativePath,
      size,
      language: detectLanguage(relativePath),
      analyzable,
    });
    let parent = path.posix.dirname(relativePath);
    while (parent !== "." && parent !== "/") {
      folders.add(parent);
      parent = path.posix.dirname(parent);
    }
  }

  return { files, folders: [...folders].sort() };
}

async function walkLocalFiles(cwd: string, relativeDir: string, out: string[]): Promise<void> {
  const absoluteDir = relativeDir ? path.join(cwd, relativeDir) : cwd;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const relativePath = toPosixRelative(relativeDir ? `${relativeDir}/${entry.name}` : entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipInventoryDirectory(entry.name)) continue;
      await walkLocalFiles(cwd, relativePath, out);
      continue;
    }
    if (entry.isSymbolicLink()) {
      try {
        const stat = await fs.stat(path.join(cwd, relativePath));
        if (stat.isFile()) out.push(relativePath);
      } catch {
        continue;
      }
      continue;
    }
    if (entry.isFile()) out.push(relativePath);
  }
}

async function gitIgnoredRelativePaths(cwd: string, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const ignored = new Set<string>();
  const chunkSize = 2000;
  for (let offset = 0; offset < paths.length; offset += chunkSize) {
    const chunk = paths.slice(offset, offset + chunkSize);
    try {
      const result = await runGitCommand(["check-ignore", "-z", "--stdin"], {
        cwd,
        envOverlay: READ_ONLY_GIT_ENV,
        input: `${chunk.join("\0")}\0`,
        timeout: 60_000,
        acceptExitCodes: [0, 1, 128],
      });
      if (result.exitCode === 128) return new Set();
      for (const relativePath of splitZeroTerminated(result.stdout)) {
        ignored.add(toPosixRelative(relativePath));
      }
    } catch {
      return new Set();
    }
  }
  return ignored;
}

export interface BoundedFileRead {
  content: string;
  truncated: boolean;
  byteLength: number;
}

/** Read a workspace file with a byte budget; binary content returns null. */
export async function readRepositoryFile(
  cwd: string,
  relativePath: string,
  maxBytes: number,
): Promise<BoundedFileRead | null> {
  const absolute = path.join(cwd, relativePath);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(absolute);
  } catch {
    return null;
  }
  if (looksBinary(buffer)) return null;
  const truncated = buffer.length > maxBytes;
  const slice = truncated ? buffer.subarray(0, maxBytes) : buffer;
  return {
    content: slice.toString("utf8"),
    truncated,
    byteLength: buffer.length,
  };
}
