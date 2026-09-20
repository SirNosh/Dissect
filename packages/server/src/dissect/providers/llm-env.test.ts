import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  overlayDissectLlmEnv,
  overlayDissectLlmEnvFromCheckout,
  parseDissectLlmEnvFile,
} from "./llm-env.js";

describe("parseDissectLlmEnvFile", () => {
  test("keeps only Dissect LLM keys and ignores daemon bind settings", () => {
    const parsed = parseDissectLlmEnvFile(`
PASEO_HOME=~/.dissect
PASEO_LISTEN=127.0.0.1:6767
DISSECT_LLM_BASE_URL=https://api.x.ai/v1
DISSECT_LLM_API_KEY=xai-test
DISSECT_LLM_MODEL=grok-4.6
OPENAI_API_KEY=sk-ignored-unless-needed
TTS_VOICE=alloy
`);
    expect(parsed).toEqual({
      DISSECT_LLM_BASE_URL: "https://api.x.ai/v1",
      DISSECT_LLM_API_KEY: "xai-test",
      DISSECT_LLM_MODEL: "grok-4.6",
      OPENAI_API_KEY: "sk-ignored-unless-needed",
    });
  });

  test("keeps SpacetimeDB keys and ignores daemon bind settings", () => {
    const parsed = parseDissectLlmEnvFile(`
PASEO_LISTEN=127.0.0.1:6767
DISSECT_SPACETIMEDB_URL=http://127.0.0.1:3000
DISSECT_SPACETIMEDB_DB=dissect
DISSECT_SPACETIMEDB_TOKEN=stdb-token
`);
    expect(parsed).toEqual({
      DISSECT_SPACETIMEDB_URL: "http://127.0.0.1:3000",
      DISSECT_SPACETIMEDB_DB: "dissect",
      DISSECT_SPACETIMEDB_TOKEN: "stdb-token",
    });
  });

  test("skips empty values and comments", () => {
    expect(
      parseDissectLlmEnvFile(`
# DISSECT_LLM_MODEL=commented
DISSECT_LLM_API_KEY=
DISSECT_LLM_MODEL=grok-4.6
`),
    ).toEqual({ DISSECT_LLM_MODEL: "grok-4.6" });
  });
});

describe("overlayDissectLlmEnv", () => {
  test("fills missing LLM keys from the file without changing process-owned values", () => {
    const overlaid = overlayDissectLlmEnv(
      {
        DISSECT_LLM_MODEL: "already-set",
        PASEO_LISTEN: "127.0.0.1:6788",
      },
      "PASEO_LISTEN=127.0.0.1:6767\nDISSECT_LLM_MODEL=from-file\nDISSECT_LLM_API_KEY=xai-test\n",
    );
    expect(overlaid.DISSECT_LLM_MODEL).toBe("already-set");
    expect(overlaid.DISSECT_LLM_API_KEY).toBe("xai-test");
    expect(overlaid.PASEO_LISTEN).toBe("127.0.0.1:6788");
  });

  test("reads an on-disk checkout env without applying PASEO_HOME", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dissect-llm-env-"));
    const filePath = path.join(dir, ".env");
    writeFileSync(
      filePath,
      "PASEO_HOME=~/.dissect\nPASEO_LISTEN=127.0.0.1:6767\nDISSECT_LLM_API_KEY=xai-disk\nDISSECT_LLM_MODEL=grok-4.6\n",
    );
    const overlaid = overlayDissectLlmEnvFromCheckout({ PASEO_HOME: "C:\\isolated" }, filePath);
    expect(overlaid.PASEO_HOME).toBe("C:\\isolated");
    expect(overlaid.PASEO_LISTEN).toBeUndefined();
    expect(overlaid.DISSECT_LLM_API_KEY).toBe("xai-disk");
    expect(overlaid.DISSECT_LLM_MODEL).toBe("grok-4.6");
  });
});
