import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_FREEBUFF_FREE_MODEL,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  FREEBUFF_FREE_AGENT_BY_MODEL,
  FREEBUFF_FREE_MODEL_IDS,
  resolveFreebuffAgentForModel,
} from "./model.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

const FREEBUFF_DRIVER_KIND = ProviderDriverKind.make("freebuff");
const CODEX_DRIVER_KIND = ProviderDriverKind.make("codex");

describe("default model truth", () => {
  // Upstream moved the free-tier default to GLM 5.3 Flash on 2026-08-30
  // (FREEBUFF_MODELS[0], unpinned 2026-09-05): unmetered, cheapest row served
  // (V4 Flash measured at 8.9x its production spend per message), open at
  // every hour. DeepSeek rows are peak-window priced, so the old default dark
  // off-peak pricing for users who did not ask for it.
  it("pins the freebuff free model (mirrors the server-side pin)", () => {
    expect(DEFAULT_FREEBUFF_FREE_MODEL).toBe("z-ai/glm-5.3-flash");
  });

  it("maps the freebuff driver to the free pin", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER[FREEBUFF_DRIVER_KIND]).toBe("z-ai/glm-5.3-flash");
  });

  it("keeps the codex driver default independent (must not inherit the free pin)", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER[CODEX_DRIVER_KIND]).toBe("gpt-5.6-sol");
  });

  it("never lets a paid default stand in for the freebuff driver", () => {
    const freebuffDefault = DEFAULT_MODEL_BY_PROVIDER[FREEBUFF_DRIVER_KIND];
    expect(freebuffDefault).toBeDefined();
    // The free tier's allowlist is enforced server-side; a paid default here
    // would show the user a model their account cannot run.
    expect(freebuffDefault).not.toMatch(/gpt-5\.6/);
  });
});

describe("FREEBUFF_FREE_AGENT_BY_MODEL", () => {
  // The LIVE free roster as of 2026-09-22 (upstream FREEBUFF_MODELS + the
  // FREEBUFF_PAUSED_FREE_MODEL_IDS pause list). Six rows died or left between
  // 2026-08-20 and 2026-09-07: v4-pro, minimax-m3, ox-alpha, glm-5.2,
  // muse-spark-1.3 all withdrawn; gemini-3.8-flash returned behind the
  // subscription paywall; kimi-k3-eco and luna-es are god-only upstream and
  // were never normal-picker rows.
  it("carries exactly the upstream free-tier pairings", () => {
    expect(Object.keys(FREEBUFF_FREE_AGENT_BY_MODEL).sort()).toEqual(
      [
        "deepseek/deepseek-v4-flash",
        "mimo/mimo-v2.5",
        "openai/gpt-5.6-luna",
        "upstage/solar-pro4",
        "z-ai/glm-5.3-flash",
        "meta/muse-spark-1.2-contributor",
      ].sort(),
    );
  });

  it("recognises no withdrawn or god-only model id", () => {
    for (const dead of [
      "deepseek/deepseek-v4-pro",
      "minimax/minimax-m3",
      "stealth/ox-alpha",
      "z-ai/glm-5.2",
      "meta/muse-spark-1.3-contributor",
      "google/gemini-3.8-flash",
      "crof/kimi-k3-eco",
      "openai/gpt-5.6-luna-es",
    ]) {
      expect(dead in FREEBUFF_FREE_AGENT_BY_MODEL, `${dead} must not be selectable`).toBe(false);
    }
  });

  it("pairs each model with the upstream agent root", () => {
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["deepseek/deepseek-v4-flash"]).toBe(
      "base3-free-deepseek-flash",
    );
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["mimo/mimo-v2.5"]).toBe("base3-free-mimo");
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["openai/gpt-5.6-luna"]).toBe("base3-free-luna");
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["z-ai/glm-5.3-flash"]).toBe("base3-free-glm-5-3-flash");
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["upstage/solar-pro4"]).toBe("base3-free-solar-pro4");
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["meta/muse-spark-1.2-contributor"]).toBe(
      "base3-free-muse-spark",
    );
  });

  it("exposes every map key as a selectable model id", () => {
    expect([...FREEBUFF_FREE_MODEL_IDS].sort()).toEqual(
      Object.keys(FREEBUFF_FREE_AGENT_BY_MODEL).sort(),
    );
  });
});

describe("resolveFreebuffAgentForModel", () => {
  it("resolves a known model to its paired agent", () => {
    expect(resolveFreebuffAgentForModel("z-ai/glm-5.3-flash")).toBe("base3-free-glm-5-3-flash");
    expect(resolveFreebuffAgentForModel("deepseek/deepseek-v4-flash")).toBe(
      "base3-free-deepseek-flash",
    );
  });

  it("coerces withdrawn picks to the default's root, never a refusal", () => {
    // Upstream #1801 doctrine: an id the client still holds must coerce at
    // admission, not 403 — refusals caused a 2.5x admissions retry loop.
    for (const withdrawn of [
      "stealth/ox-alpha",
      "minimax/minimax-m3",
      "deepseek/deepseek-v4-pro",
      "z-ai/glm-5.2",
      "meta/muse-spark-1.3-contributor",
    ]) {
      expect(resolveFreebuffAgentForModel(withdrawn)).toBe("base3-free-glm-5-3-flash");
    }
  });

  it("falls back to the free pin's agent for unknown models", () => {
    expect(resolveFreebuffAgentForModel("acme/nonexistent")).toBe("base3-free-glm-5-3-flash");
  });

  it("falls back when the selection is absent", () => {
    expect(resolveFreebuffAgentForModel(undefined)).toBe("base3-free-glm-5-3-flash");
  });
});
