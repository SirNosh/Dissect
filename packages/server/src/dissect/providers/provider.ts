import type { z } from "zod";

/**
 * Minimal provider boundary for Dissect analysis.
 *
 * The rest of Dissect depends only on this interface plus the structured-call
 * helper; the concrete model/API lives behind the adapter so it can be swapped
 * without touching the UI, schemas, repository pipeline, or persistence.
 */

export interface DissectProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface DissectChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DissectTextProvider {
  /** Complete a chat request and return raw assistant text. */
  complete(input: {
    messages: DissectChatMessage[];
    jsonMode: boolean;
    maxTokens?: number;
  }): Promise<string>;
}

export interface ResolvedProviderState {
  provider: DissectTextProvider | null;
  configured: boolean;
  configurationHint: string | null;
}

export interface DissectAnalysisConfigs {
  code: DissectProviderConfig | null;
  architecture: DissectProviderConfig | null;
  hint: string | null;
}

const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
const GROK_DEFAULT_BASE_URL = "https://api.x.ai/v1";
const GROK_DEFAULT_MODEL = "grok-4";

function hasEnvValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Resolve provider configuration from generic environment values.
 * DISSECT_LLM_BASE_URL / DISSECT_LLM_API_KEY / DISSECT_LLM_MODEL, with
 * OPENAI_API_KEY accepted as an API-key fallback for convenience.
 */
export function resolveDissectProviderConfig(env: Record<string, string | undefined>): {
  config: DissectProviderConfig | null;
  hint: string | null;
} {
  const baseUrl = (env.DISSECT_LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const apiKey = env.DISSECT_LLM_API_KEY ?? env.OPENAI_API_KEY ?? "";
  const model = env.DISSECT_LLM_MODEL ?? "";
  if (!model && !apiKey) {
    return {
      config: null,
      hint: "Configure DISSECT_LLM_MODEL and DISSECT_LLM_API_KEY, then retry.",
    };
  }
  if (!model) {
    return { config: null, hint: "Configure DISSECT_LLM_MODEL, then retry." };
  }
  if (!apiKey) {
    return { config: null, hint: "Configure DISSECT_LLM_API_KEY, then retry." };
  }
  return { config: { baseUrl, apiKey, model }, hint: null };
}

function resolveGeminiConfig(
  env: Record<string, string | undefined>,
): DissectProviderConfig | null {
  if (!hasEnvValue(env.GEMINI_API_KEY)) return null;
  return {
    baseUrl: stripTrailingSlash(env.GEMINI_BASE_URL ?? GEMINI_DEFAULT_BASE_URL),
    apiKey: env.GEMINI_API_KEY.trim(),
    model: hasEnvValue(env.GEMINI_MODEL) ? env.GEMINI_MODEL.trim() : GEMINI_DEFAULT_MODEL,
  };
}

function resolveGrokConfig(env: Record<string, string | undefined>): DissectProviderConfig | null {
  const apiKey = env.GROK_API_KEY ?? env.XAI_API_KEY;
  if (!hasEnvValue(apiKey)) return null;
  const model = env.GROK_MODEL ?? env.XAI_MODEL;
  return {
    baseUrl: stripTrailingSlash(env.GROK_BASE_URL ?? env.XAI_BASE_URL ?? GROK_DEFAULT_BASE_URL),
    apiKey: apiKey.trim(),
    model: hasEnvValue(model) ? model.trim() : GROK_DEFAULT_MODEL,
  };
}

/**
 * Gemini handles file-level Dissect. Grok handles architecture maps.
 * DISSECT_LLM_* / OPENAI_API_KEY remain a fallback when a dedicated key is unset.
 */
export function resolveDissectAnalysisConfigs(
  env: Record<string, string | undefined>,
): DissectAnalysisConfigs {
  const fallback = resolveDissectProviderConfig(env).config;
  const code = resolveGeminiConfig(env) ?? fallback;
  const architecture = resolveGrokConfig(env) ?? fallback;
  if (code && architecture) {
    return { code, architecture, hint: null };
  }
  if (!code && !architecture) {
    return {
      code: null,
      architecture: null,
      hint: "Set GEMINI_API_KEY for file-level Dissect and GROK_API_KEY for architecture maps.",
    };
  }
  if (!code) {
    return { code: null, architecture, hint: "Set GEMINI_API_KEY for file-level Dissect." };
  }
  return {
    code,
    architecture: null,
    hint: "Set GROK_API_KEY (or XAI_API_KEY) for architecture maps.",
  };
}

/**
 * Strip a single wrapping Markdown code fence if the model added one despite
 * JSON-mode instructions. This is bounded normalization, not scraping: content
 * must be exactly one fenced block or it is returned unchanged.
 */
function normalizeJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

export class StructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/**
 * Request schema-validated structured output with exactly one bounded
 * repair/retry. A second invalid response fails visibly.
 */
export async function callStructured<TSchema extends z.ZodType>(
  provider: DissectTextProvider,
  schema: TSchema,
  input: { system: string; user: string; maxTokens?: number },
): Promise<z.infer<TSchema>> {
  const messages: DissectChatMessage[] = [
    { role: "system", content: input.system },
    { role: "user", content: input.user },
  ];

  const attempt = async (extra: DissectChatMessage[]): Promise<z.infer<TSchema> | string> => {
    const raw = await provider.complete({
      messages: [...messages, ...extra],
      jsonMode: true,
      maxTokens: input.maxTokens,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(normalizeJsonPayload(raw));
    } catch (error) {
      return `Response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
    }
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    const issues = result.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    return `Response JSON did not match the required schema: ${issues}`;
  };

  const first = await attempt([]);
  if (typeof first !== "string") return first;

  const second = await attempt([
    {
      role: "user",
      content:
        `Your previous response was invalid. ${first}\n` +
        "Return ONLY a corrected JSON object that satisfies the schema described earlier. " +
        "No prose, no Markdown fences.",
    },
  ]);
  if (typeof second !== "string") return second;

  throw new StructuredOutputError(second);
}
