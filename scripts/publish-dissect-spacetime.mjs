import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(repoRoot, "spacetime", "dissect");

function findSpacetimeCli() {
  if (process.env.SPACETIME_CLI?.trim()) return process.env.SPACETIME_CLI.trim();
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["spacetime"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const fromPath = which.stdout
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (fromPath) return fromPath;
  const windowsDefault = path.join(process.env.LOCALAPPDATA ?? "", "SpacetimeDB", "spacetime.exe");
  if (existsSync(windowsDefault)) return windowsDefault;
  throw new Error(
    "spacetime CLI not found. Install SpacetimeDB locally or set SPACETIME_CLI to the binary.",
  );
}

const cli = findSpacetimeCli();
const publish = spawnSync(cli, ["publish", "-s", "local", "-p", modulePath, "--yes", "dissect"], {
  stdio: "inherit",
  cwd: repoRoot,
  shell: false,
});
if ((publish.status ?? 1) !== 0) {
  process.exit(publish.status ?? 1);
}

const bindingsDir = path.join(modulePath, "bindings");
const generate = spawnSync(
  cli,
  ["generate", "-p", modulePath, "-l", "typescript", "-o", bindingsDir, "--yes", "dissect"],
  { stdio: "inherit", cwd: repoRoot, shell: false },
);
process.exit(generate.status ?? 1);
