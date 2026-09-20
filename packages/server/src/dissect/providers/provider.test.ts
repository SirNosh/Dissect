import { describe, expect, test } from "vitest";
import { resolveDissectAnalysisConfigs } from "./provider.js";

describe("resolveDissectAnalysisConfigs", () => {
  test("uses Gemini for code and Grok for architecture", () => {
    const resolved = resolveDissectAnalysisConfigs({
      GEMINI_API_KEY: "gemini-key",
      GROK_API_KEY: "grok-key",
    });
    expect(resolved.hint).toBeNull();
    expect(resolved.code).toEqual({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gemini-key",
      model: "gemini-2.5-flash",
    });
    expect(resolved.architecture).toEqual({
      baseUrl: "https://api.x.ai/v1",
      apiKey: "grok-key",
      model: "grok-4",
    });
  });

  test("accepts XAI_API_KEY as the Grok key", () => {
    const resolved = resolveDissectAnalysisConfigs({
      GEMINI_API_KEY: "gemini-key",
      XAI_API_KEY: "xai-key",
      GROK_MODEL: "grok-4.6",
    });
    expect(resolved.architecture?.apiKey).toBe("xai-key");
    expect(resolved.architecture?.model).toBe("grok-4.6");
  });

  test("falls back to DISSECT_LLM when a dedicated key is missing", () => {
    const resolved = resolveDissectAnalysisConfigs({
      GEMINI_API_KEY: "gemini-key",
      DISSECT_LLM_API_KEY: "openai-key",
      DISSECT_LLM_MODEL: "gpt-5",
    });
    expect(resolved.code?.apiKey).toBe("gemini-key");
    expect(resolved.architecture).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "openai-key",
      model: "gpt-5",
    });
  });

  test("asks for both keys when nothing is configured", () => {
    expect(resolveDissectAnalysisConfigs({}).hint).toBe(
      "Set GEMINI_API_KEY for file-level Dissect and GROK_API_KEY for architecture maps.",
    );
  });
});
