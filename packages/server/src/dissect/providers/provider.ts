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
