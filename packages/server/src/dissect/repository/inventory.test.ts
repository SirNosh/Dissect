import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectRepositoryInventory } from "./inventory.js";
import { shouldSkipInventoryDirectory } from "./filters.js";

describe("shouldSkipInventoryDirectory", () => {
  it("skips build artifacts, VCS, and hidden folders except .github", () => {
    expect(shouldSkipInventoryDirectory("node_modules")).toBe(true);
    expect(shouldSkipInventoryDirectory(".git")).toBe(true);
    expect(shouldSkipInventoryDirectory(".vscode")).toBe(true);
    expect(shouldSkipInventoryDirectory(".github")).toBe(false);
    expect(shouldSkipInventoryDirectory("src")).toBe(false);
  });
});

describe("collectRepositoryInventory", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createWorkspace(): string {
    const directory = mkdtempSync(join(tmpdir(), "dissect-inventory-"));
    directories.push(directory);
    return directory;
  }

  it("walks local files and skips gitignored plus excluded directories", async () => {
    const cwd = createWorkspace();
    execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "pipe" });
    writeFileSync(join(cwd, ".gitignore"), "ignored/\n*.log\n");
    mkdirSync(join(cwd, "src"), { recursive: true });
    mkdirSync(join(cwd, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(cwd, "ignored"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.ts"), "export const n = 1;\n");
    writeFileSync(join(cwd, "local-untracked.ts"), "export {};\n");
    writeFileSync(join(cwd, "noise.log"), "log\n");
    writeFileSync(join(cwd, ".env"), "SECRET=1\n");
    writeFileSync(join(cwd, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
    writeFileSync(join(cwd, "ignored", "secret.ts"), "export const s = 1;\n");

    const inventory = await collectRepositoryInventory(cwd);
    const paths = inventory.files.map((file) => file.path);

    expect(paths).toContain("src/app.ts");
    expect(paths).toContain("local-untracked.ts");
    expect(paths).not.toContain("node_modules/pkg/index.js");
    expect(paths).not.toContain("ignored/secret.ts");
    expect(paths).not.toContain("noise.log");
    expect(paths).not.toContain(".env");
    expect(inventory.folders).toEqual(["src"]);
  });

  it("does not list index-only paths that are missing on disk", async () => {
    const cwd = createWorkspace();
    execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "pipe" });
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "gone.ts"), "export {};\n");
    execFileSync("git", ["add", "src/gone.ts"], { cwd, stdio: "pipe" });
    execFileSync(
      "git",
      ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "add"],
      {
        cwd,
        stdio: "pipe",
      },
    );
    rmSync(join(cwd, "src", "gone.ts"));
    writeFileSync(join(cwd, "src", "local.ts"), "export {};\n");

    const inventory = await collectRepositoryInventory(cwd);
    const paths = inventory.files.map((file) => file.path);
    expect(paths).toContain("src/local.ts");
    expect(paths).not.toContain("src/gone.ts");
  });

  it("inventories a non-git workspace from disk only", async () => {
    const cwd = createWorkspace();
    mkdirSync(join(cwd, "lib"), { recursive: true });
    writeFileSync(join(cwd, "lib", "main.ts"), "export {};\n");
    writeFileSync(join(cwd, "README.md"), "hello\n");

    const inventory = await collectRepositoryInventory(cwd);
    expect(inventory.files.map((file) => file.path).sort()).toEqual(["README.md", "lib/main.ts"]);
  });
});
