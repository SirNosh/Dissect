import { runGitCommand } from "../../utils/run-git-command.js";

const READ_ONLY_GIT_ENV = { GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };

export type SnapshotFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface SnapshotChangedFile {
  path: string;
  oldPath: string | null;
  status: SnapshotFileStatus;
}

function parseStatusCode(code: string): SnapshotFileStatus {
  switch (code[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}

/** List files changed between two tree snapshots. */
export async function listChangedFilesBetweenSnapshots(
  cwd: string,
  fromTreeSha: string,
  toTreeSha: string,
): Promise<SnapshotChangedFile[]> {
  const result = await runGitCommand(
    ["diff", "--name-status", "-z", "--find-renames", fromTreeSha, toTreeSha],
    { cwd, envOverlay: READ_ONLY_GIT_ENV, timeout: 120_000 },
  );
  const tokens = result.stdout.split("\0").filter((token) => token.length > 0);
  const changed: SnapshotChangedFile[] = [];
  let index = 0;
  while (index < tokens.length) {
    const code = tokens[index++];
    if (!code) break;
    const status = parseStatusCode(code);
    if (status === "renamed") {
      const oldPath = tokens[index++];
      const newPath = tokens[index++];
      if (oldPath && newPath) changed.push({ path: newPath, oldPath, status });
    } else {
      const filePath = tokens[index++];
      if (filePath) changed.push({ path: filePath, oldPath: null, status });
    }
  }
  return changed;
}

/** Unified diff between two tree snapshots, optionally scoped to given paths. */
export async function unifiedDiffBetweenSnapshots(
  cwd: string,
  fromTreeSha: string,
  toTreeSha: string,
  paths?: string[],
): Promise<string> {
  const args = ["diff", "--unified=3", "--no-color", "--find-renames", fromTreeSha, toTreeSha];
  if (paths && paths.length > 0) {
    args.push("--", ...paths);
  }
  const result = await runGitCommand(args, {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    timeout: 120_000,
    maxOutputBytes: 8 * 1024 * 1024,
  });
  return result.stdout;
}

/** Read one file's content from a tree snapshot. Returns null when absent. */
export async function readFileAtSnapshot(
  cwd: string,
  treeSha: string,
  filePath: string,
): Promise<string | null> {
  const result = await runGitCommand(["show", `${treeSha}:${filePath}`], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    timeout: 60_000,
    acceptExitCodes: [0, 128],
  });
  return result.exitCode === 0 ? result.stdout : null;
}
