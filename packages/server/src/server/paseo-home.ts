import os from "node:os";
import path from "node:path";

function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === "~") {
    return os.homedir();
  }
  return input;
}

export function resolvePaseoHome(env: NodeJS.ProcessEnv = process.env): string {
  // Dissect fork: default data root moved to ~/.dissect so a Paseo install on
  // the same machine keeps its own daemon state and workspaces.
  const raw = env.PASEO_HOME ?? "~/.dissect";
  const resolved = path.resolve(expandHomeDir(raw));
  return resolved;
}
