import { createHash } from "node:crypto";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Stable short identifier for a workspace path, used as the store file name. */
export function projectKeyForCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return sha256Hex(normalized).slice(0, 24);
}
