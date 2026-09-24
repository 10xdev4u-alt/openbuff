import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_FREEBUFF_FREE_MODEL,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  FREEBUFF_FREE_AGENT_BY_MODEL,
  FREEBUFF_FREE_MODEL_IDS,
  FREEBUFF_FREE_PICKER_MODEL_IDS,
  resolveFreebuffAgentForModel,
  resolveFreebuffServedModel,
  FREEBUFF_PROMPT_RETENTION_MODEL_SLUGS,
  FREEBUFF_TRAINING_DATA_MODEL_SLUGS,
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
  // The SERVABLE free roster, verified against live upstream 2026-09-24
  // (FREEBUFF_MODELS + SUPPORTED + the paused list + FREE_MODE_AGENT_MODELS).
  // gpt-6-luna (09-22), solar-mini4 and stealth/space-bunny-alpha (09-23)
  // joined; gpt-5.6-luna and solar-pro4 left every picker the same days but
  // stay admissible — drain rows keep their agent pairings.
  it("carries exactly the upstream servable pairings", () => {
    expect(Object.keys(FREEBUFF_FREE_AGENT_BY_MODEL).sort()).toEqual(
      [
        "deepseek/deepseek-v4-flash",
        "mimo/mimo-v2.5",
        "openai/gpt-6-luna",
        "openai/gpt-5.6-luna",
        "stealth/space-bunny-alpha",
        "upstage/solar-mini4",
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
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["openai/gpt-6-luna"]).toBe("base3-free-luna-6");
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["upstage/solar-mini4"]).toBe(
      "base3-free-solar-mini4",
    );
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["stealth/space-bunny-alpha"]).toBe(
      "base3-free-space-bunny-alpha",
    );
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["z-ai/glm-5.3-flash"]).toBe("base3-free-glm-5-3-flash");
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["meta/muse-spark-1.2-contributor"]).toBe(
      "base3-free-muse-spark",
    );
  });

  it("keeps the picker-retired drain rows resolvable at admission", () => {
    // Upstream retirement is two-staged: the row leaves FREEBUFF_MODELS (all
    // pickers) the day its replacement joins, while staying in
    // SUPPORTED_FREEBUFF_MODELS and admissible so sessions admitted before
    // the swap drain on it. Dropping these pairings would turn drain picks
    // into refusals — the #1801 retry loop — so they stay.
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["openai/gpt-5.6-luna"]).toBe("base3-free-luna");
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["upstage/solar-pro4"]).toBe("base3-free-solar-pro4");
  });

  it("exposes every map key as an admissible model id (drain rows included)", () => {
    expect([...FREEBUFF_FREE_MODEL_IDS].sort()).toEqual(
      Object.keys(FREEBUFF_FREE_AGENT_BY_MODEL).sort(),
    );
  });

  it("offers exactly the upstream picker rows, retired rows excluded", () => {
    // The picker is upstream FREEBUFF_MODELS filtered to the free tier
    // (verified 2026-09-24): the default leads, then flash, gpt-6-luna, mimo,
    // solar-mini4, space-bunny-alpha, muse-spark-1.2. The drain rows
    // (gpt-5.6-luna, solar-pro4) are servable but NOT freshly selectable.
    expect([...FREEBUFF_FREE_PICKER_MODEL_IDS]).toEqual([
      "z-ai/glm-5.3-flash",
      "deepseek/deepseek-v4-flash",
      "openai/gpt-6-luna",
      "mimo/mimo-v2.5",
      "upstage/solar-mini4",
      "stealth/space-bunny-alpha",
      "meta/muse-spark-1.2-contributor",
    ]);
    for (const pickerId of FREEBUFF_FREE_PICKER_MODEL_IDS) {
      expect(pickerId in FREEBUFF_FREE_AGENT_BY_MODEL, `${pickerId} must be servable`).toBe(true);
    }
    for (const drainRow of ["openai/gpt-5.6-luna", "upstage/solar-pro4"]) {
      expect(FREEBUFF_FREE_PICKER_MODEL_IDS).not.toContain(drainRow);
    }
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

  it("resolves the new 09-22/23 rows to their own roots, not the default", () => {
    expect(resolveFreebuffAgentForModel("openai/gpt-6-luna")).toBe("base3-free-luna-6");
    expect(resolveFreebuffAgentForModel("upstage/solar-mini4")).toBe("base3-free-solar-mini4");
    expect(resolveFreebuffAgentForModel("stealth/space-bunny-alpha")).toBe(
      "base3-free-space-bunny-alpha",
    );
  });

  it("still resolves drain picks (picker-retired, admissible) without coercion", () => {
    expect(resolveFreebuffAgentForModel("openai/gpt-5.6-luna")).toBe("base3-free-luna");
    expect(resolveFreebuffAgentForModel("upstage/solar-pro4")).toBe("base3-free-solar-pro4");
  });
});

describe("resolveFreebuffServedModel", () => {
  // The admission/suite coherence contract: both model-consuming legs of a
  // free session resolve their model through THIS function, so a pick the
  // pairing map cannot serve falls through to the tier default on BOTH legs
  // and upstream's session gate never sees `session_model_mismatch`.
  it("serves picker rows and drain rows as-is", () => {
    expect(resolveFreebuffServedModel("z-ai/glm-5.3-flash")).toBe("z-ai/glm-5.3-flash");
    expect(resolveFreebuffServedModel("openai/gpt-6-luna")).toBe("openai/gpt-6-luna");
    expect(resolveFreebuffServedModel("openai/gpt-5.6-luna")).toBe("openai/gpt-5.6-luna");
    expect(resolveFreebuffServedModel("upstage/solar-pro4")).toBe("upstage/solar-pro4");
  });

  it("refuses to serve withdrawn or unknown ids", () => {
    for (const dead of [
      "stealth/ox-alpha",
      "minimax/minimax-m3",
      "deepseek/deepseek-v4-pro",
      "meta/muse-spark-1.3-contributor",
      "acme/nonexistent",
    ]) {
      expect(resolveFreebuffServedModel(dead), dead).toBeUndefined();
    }
  });

  it("an absent selection stays absent (caller pins the default)", () => {
    expect(resolveFreebuffServedModel(undefined)).toBeUndefined();
  });

  it("answers `undefined` for exactly the ids resolveFreebuffAgentForModel coerces", () => {
    // The two resolvers must agree on the servable set or the legs diverge.
    const probe = [
      "z-ai/glm-5.3-flash",
      "openai/gpt-6-luna",
      "openai/gpt-5.6-luna",
      "stealth/ox-alpha",
      "acme/nonexistent",
    ];
    for (const model of probe) {
      const coerced = resolveFreebuffAgentForModel(model);
      const served = resolveFreebuffServedModel(model);
      if (served !== undefined) {
        expect(resolveFreebuffAgentForModel(served)).toBe(coerced);
      } else {
        expect(coerced).toBe(resolveFreebuffAgentForModel("z-ai/glm-5.3-flash"));
      }
    }
  });

  it("pins the disclosure sets (training + prompt retention)", () => {
    // The picker renders a badge per slug in these sets; they must stay in
    // lockstep with the servable roster (upstream evidence 2026-09-24:
    // Muse Spark 1.2 = dataUse 'training', Space Bunny Alpha = stealth
    // host retaining prompts, dataUse 'service').
    expect([...FREEBUFF_TRAINING_DATA_MODEL_SLUGS].sort()).toEqual([
      "meta/muse-spark-1.2-contributor",
    ]);
    expect([...FREEBUFF_PROMPT_RETENTION_MODEL_SLUGS].sort()).toEqual([
      "stealth/space-bunny-alpha",
    ]);
  });
});
