/**
 * Repository filter logic for the Dissect analysis pipeline.
 *
 * Filters decide which local workspace files may have their contents sent to
 * the analysis model. Excluded files stay in the tree metadata; they are
 * simply never read for LLM analysis.
 */

const EXCLUDED_DIRECTORY_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".expo",
  ".turbo",
  ".cache",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".gradle",
  "Pods",
  "DerivedData",
]);

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "icns",
  "bmp",
  "tiff",
  "svgz",
  "pdf",
  "zip",
  "gz",
  "tar",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "jar",
  "war",
  "class",
  "exe",
  "dll",
  "so",
  "dylib",
  "a",
  "o",
  "bin",
  "dat",
  "db",
  "sqlite",
  "sqlite3",
  "wasm",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "mp3",
  "mp4",
  "wav",
  "ogg",
  "webm",
  "mov",
  "avi",
  "keystore",
  "jks",
  "p12",
  "pfx",
  "heic",
  "psd",
  "ai",
]);

const EXCLUDED_FILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "composer.lock",
  "cargo.lock",
  "gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "flake.lock",
  ".ds_store",
]);

/** Files larger than this are never sent to the analysis model. */
export const MAX_ANALYZABLE_FILE_BYTES = 262_144; // 256 KiB

/** Per-file content budget inside a batched summary request. */
export const MAX_SUMMARY_CONTENT_BYTES = 16_384;

function isMinifiedName(fileName: string): boolean {
  return /\.min\.(js|css)$/i.test(fileName) || /\.bundle\.js$/i.test(fileName);
}

/** True when a directory should not be walked for local Dissect inventory. */
export function shouldSkipInventoryDirectory(name: string): boolean {
  if (name === "." || name === "..") return true;
  if (EXCLUDED_DIRECTORY_SEGMENTS.has(name)) return true;
  return name.startsWith(".") && name !== ".github";
}

export function isAnalyzableSourcePath(path: string): boolean {
  const segments = path.split("/");
  const fileName = segments[segments.length - 1] ?? path;
  for (const segment of segments.slice(0, -1)) {
    if (EXCLUDED_DIRECTORY_SEGMENTS.has(segment)) return false;
  }
  if (EXCLUDED_FILE_NAMES.has(fileName.toLowerCase())) return false;
  if (isMinifiedName(fileName)) return false;
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  if (BINARY_EXTENSIONS.has(extension)) return false;
  return true;
}

/** Cheap binary sniff on already-read content. */
export function looksBinary(content: Buffer): boolean {
  const sample = content.subarray(0, 8192);
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}
