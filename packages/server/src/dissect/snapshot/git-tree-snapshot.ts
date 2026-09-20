import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGitCommand } from "../../utils/run-git-command.js";

const GIT_TREE_SHA = /^[0-9a-f]{40,64}$/;
const READ_ONLY_GIT_ENV = { GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };

export class NotAGitRepositoryError extends Error {
  constructor() {
    super("Workspace is not a git repository.");
    this.name = "NotAGitRepositoryError";
  }
}

export function assertGitTreeSha(value: string, label: string): void {
  if (!GIT_TREE_SHA.test(value)) {
    throw new Error(`Invalid ${label} snapshot id.`);
  }
}

async function ensureGitWorkTree(cwd: string): Promise<void> {
  const probe = await runGitCommand(["rev-parse", "--is-inside-work-tree"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 128],
  });
  if (probe.exitCode !== 0 || probe.stdout.trim() !== "true") {
    throw new NotAGitRepositoryError();
  }
}

/**
 * Capture the current working tree (tracked modifications, additions,
 * deletions, and untracked non-ignored files) as a Git tree object without
 * touching the user's real index and without creating a commit.
 *
 * Used only for Dissect Diff agent-turn deltas. The initial codebase
 * dissection never calls this; it reads files from disk.
 *
 * Strategy: point GIT_INDEX_FILE at a temporary index, seed it from HEAD,
 * `git add -A`, then `git write-tree`.
 */
export async function captureWorkingTreeSnapshot(cwd: string): Promise<string> {
  await ensureGitWorkTree(cwd);
  const tempIndexPath = path.join(os.tmpdir(), `dissect-index-${randomUUID()}`);
  const envOverlay = { GIT_INDEX_FILE: tempIndexPath, ...READ_ONLY_GIT_ENV };
  try {
    const head = await runGitCommand(["rev-parse", "--verify", "--quiet", "HEAD"], {
      cwd,
      envOverlay,
      acceptExitCodes: [0, 1],
    });
    if (head.exitCode === 0) {
      await runGitCommand(["read-tree", "HEAD"], { cwd, envOverlay, timeout: 60_000 });
    } else {
      await runGitCommand(["read-tree", "--empty"], { cwd, envOverlay, timeout: 60_000 });
    }
    await runGitCommand(["add", "-A"], { cwd, envOverlay, timeout: 120_000 });
    const written = await runGitCommand(["write-tree"], { cwd, envOverlay, timeout: 60_000 });
    const treeSha = written.stdout.trim();
    assertGitTreeSha(treeSha, "working-tree");
    return treeSha;
  } finally {
    await fs.rm(tempIndexPath, { force: true }).catch(() => undefined);
  }
}
