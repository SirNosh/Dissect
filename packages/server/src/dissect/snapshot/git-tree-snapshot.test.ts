import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { captureWorkingTreeSnapshot, NotAGitRepositoryError } from "./git-tree-snapshot.js";

describe("captureWorkingTreeSnapshot", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails cleanly on a folder that is not a git repository", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dissect-nongit-"));
    directories.push(cwd);
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.ts"), "export const n = 1;\n");

    await expect(captureWorkingTreeSnapshot(cwd)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof NotAGitRepositoryError && !error.message.includes("Git command failed"),
    );
  });

  it("writes a tree object for a git workspace", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dissect-git-"));
    directories.push(cwd);
    execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "pipe" });
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.ts"), "export const n = 1;\n");

    const treeSha = await captureWorkingTreeSnapshot(cwd);
    expect(treeSha).toMatch(/^[0-9a-f]{40,64}$/);
  });
});
