import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_FREEBUFF_FREE_MODEL, FREEBUFF_FREE_PICKER_MODEL_IDS } from "@t3tools/contracts";

import { freebuffSnapshotModels } from "./FreebuffDriver.ts";

describe("freebuffSnapshotModels", () => {
  it("serves exactly the picker rows plus the listed locked rows", () => {
    const models = freebuffSnapshotModels();
    expect(models.map((model) => model.slug).sort()).toEqual(
      [
        ...FREEBUFF_FREE_PICKER_MODEL_IDS,
        // Listed, not hidden (upstream freebuffPlanRequired): tier-locked
        // rows render disabled in the picker instead of vanishing.
        "google/gemini-3.8-flash",
        "mimo/mimo-v2.6-pro",
        "openai/gpt-6-luna",
      ].sort(),
    );
    expect(models).toHaveLength(10);
  });

  it("carries only upstream-live free rows (re-verified 2026-09-26)", () => {
    // Withdrawn 2026-08-20 → 2026-09-07 (upstream FREEBUFF_PAUSED_FREE_MODEL_IDS),
    // paywalled, god-only, or picker-retired — none may appear as a fresh pick.
    const slugs = freebuffSnapshotModels().map((model) => model.slug);
    for (const dead of [
      "stealth/ox-alpha",
      "meta/muse-spark-1.3-contributor",
      "minimax/minimax-m3",
      "deepseek/deepseek-v4-pro",
      "z-ai/glm-5.2",
      "crof/kimi-k3-eco",
      "openai/gpt-5.6-luna-es",
      // Paused 2026-09-24 (stage two): nothing needs it admitted any more.
      "openai/gpt-5.6-luna",
      // Limited-offer row: server-pushed only, never a client picker row.
      "anthropic/claude-fable-5.1",
    ]) {
      expect(slugs).not.toContain(dead);
    }
    // The 1.2 replacement that took 1.3's slot on 2026-09-07.
    expect(slugs).toContain("meta/muse-spark-1.2-contributor");
    // RETURNED 2026-09-25 beside Solar Mini 4 after its 09-23 retirement.
    expect(slugs).toContain("upstage/solar-pro4");
  });

  it("names every row from the upstream display-name map", () => {
    for (const model of freebuffSnapshotModels()) {
      expect(model.name, `unrendered slug: ${model.slug}`).not.toBe(model.slug);
    }
  });

  it("pins the GLM 5.3 Flash row as the tier default (upstream's 2026-08-30 default move)", () => {
    const glm = freebuffSnapshotModels().find(
      (model) => model.slug === "z-ai/glm-5.3-flash",
    );
    expect(glm?.isDefault).toBe(true);
    expect(glm?.name).toBe("GLM 5.3 Flash");
    expect(DEFAULT_FREEBUFF_FREE_MODEL).toBe("z-ai/glm-5.3-flash");
  });

  it("labels every row with the upstream display name", () => {
    const namesBySlug = new Map(
      freebuffSnapshotModels().map((model) => [model.slug, model.name] as const),
    );
    expect(namesBySlug.get("z-ai/glm-5.3-flash")).toBe("GLM 5.3 Flash");
    expect(namesBySlug.get("deepseek/deepseek-v4-flash")).toBe("DeepSeek V4.1 Flash");
    expect(namesBySlug.get("mimo/mimo-v2.5")).toBe("MiMo 2.6 Flash");
    expect(namesBySlug.get("upstage/solar-mini4")).toBe("Solar Mini 4");
    expect(namesBySlug.get("upstage/solar-pro4")).toBe("Solar Pro 4");
    expect(namesBySlug.get("stealth/space-bunny-alpha")).toBe("Space Bunny Alpha");
    expect(namesBySlug.get("meta/muse-spark-1.2-contributor")).toBe("Muse Spark 1.2");
  });

  it("marks every row built-in with no capability descriptors", () => {
    for (const model of freebuffSnapshotModels()) {
      expect(model.isCustom).toBe(false);
      expect(model.capabilities).toBeNull();
    }
  });

  it("lists the tier-locked rows inline, never as legacy", () => {
    // Upstream's doctrine: LISTED, not hidden — locked rows draw inline
    // and disabled (the web picker's lock gate), never behind a collapsed
    // legacy section, and never flagged legacy (they are not legacy; they
    // are gated). Servable rows carry explicit isLegacy:false so a legacy
    // sibling can never claim them either.
    const bySlug = new Map(freebuffSnapshotModels().map((m) => [m.slug, m] as const));
    for (const locked of ["openai/gpt-6-luna", "mimo/mimo-v2.6-pro", "google/gemini-3.8-flash"]) {
      expect(bySlug.get(locked)?.isLegacy, locked).toBe(false);
    }
    for (const slug of FREEBUFF_FREE_PICKER_MODEL_IDS) {
      expect(bySlug.get(slug)?.isLegacy, slug).toBe(false);
    }
  });
});
