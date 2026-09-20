import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DISSECT_ENV_KEYS = [
  "DISSECT_LLM_BASE_URL",
  "DISSECT_LLM_API_KEY",
  "DISSECT_LLM_MODEL",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_BASE_URL",
  "GROK_API_KEY",
  "GROK_MODEL",
  "GROK_BASE_URL",
  "XAI_API_KEY",
  "XAI_MODEL",
  "XAI_BASE_URL",
  "DISSECT_SPACETIMEDB_URL",
  "DISSECT_SPACETIMEDB_DB",
  "DISSECT_SPACETIMEDB_TOKEN",
  "DISSECT_SPACETIMEDB_DISABLED",
] as const;

type DissectEnvKey = (typeof DISSECT_ENV_KEYS)[number];

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isDissectEnvKey(name: string): name is DissectEnvKey {
  return (DISSECT_ENV_KEYS as readonly string[]).includes(name);
}

/**
 * Parse only Dissect LLM and SpacetimeDB keys from a dotenv-style file.
 * PASEO_HOME, PASEO_LISTEN, and every other key are ignored so a server .env
 * cannot steal the desktop isolation port or home.
 */
export function parseDissectLlmEnvFile(contents: string): Partial<Record<DissectEnvKey, string>> {
  const parsed: Partial<Record<DissectEnvKey, string>> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const assignment = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = assignment.slice(0, separator).trim();
    if (!isDissectEnvKey(name)) {
      continue;
    }
    const value = stripQuotes(assignment.slice(separator + 1).trim());
    if (hasValue(value)) {
      parsed[name] = value;
    }
  }
  return parsed;
}

export function overlayDissectLlmEnv(
  env: Record<string, string | undefined>,
  fileContents: string | null,
): Record<string, string | undefined> {
  if (fileContents === null) {
    return env;
  }
  const fromFile = parseDissectLlmEnvFile(fileContents);
  const next = { ...env };
  for (const key of DISSECT_ENV_KEYS) {
    if (hasValue(next[key]) || !hasValue(fromFile[key])) {
      continue;
    }
    next[key] = fromFile[key];
  }
  return next;
}

export function resolveCheckoutServerEnvPath(): string {
  return fileURLToPath(new URL("../../../../.env", import.meta.url));
}

export function readDissectLlmEnvFile(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath, "utf8");
}

export function overlayDissectLlmEnvFromCheckout(
  env: Record<string, string | undefined>,
  envFilePath: string = resolveCheckoutServerEnvPath(),
): Record<string, string | undefined> {
  return overlayDissectLlmEnv(env, readDissectLlmEnvFile(envFilePath));
}
