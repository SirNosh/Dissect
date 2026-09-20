import type { DissectChatMessage, DissectProviderConfig, DissectTextProvider } from "./provider.js";

const REQUEST_TIMEOUT_MS = 240_000;

/**
 * Text provider speaking the OpenAI-compatible chat-completions protocol.
 * Works against any endpoint that implements `POST {base}/chat/completions`.
 */
export class OpenAICompatibleProvider implements DissectTextProvider {
  constructor(private readonly config: DissectProviderConfig) {}

  async complete(input: {
    messages: DissectChatMessage[];
    jsonMode: boolean;
    maxTokens?: number;
  }): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: input.messages,
          ...(input.jsonMode ? { response_format: { type: "json_object" } } : {}),
          ...(input.maxTokens ? { max_completion_tokens: input.maxTokens } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        // Never echo credentials; body is provider error text only.
        throw new Error(
          `Analysis model request failed (${response.status}): ${body.slice(0, 500)}`,
        );
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new Error("Analysis model returned an empty response.");
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}
