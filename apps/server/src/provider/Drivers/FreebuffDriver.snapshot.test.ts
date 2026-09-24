import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_FREEBUFF_FREE_MODEL, FREEBUFF_FREE_MODEL_IDS } from "@t3tools/contracts";

import { freebuffSnapshotModels } from "./FreebuffDriver.ts";

describe("freebuffSnapshotModels", () => {
  it("serves exactly the allowlisted free-tier rows", () => {
    const models = freebuffSnapshotModels();
    expect(models.map((model) => model.slug).sort()).toEqual([...FREEBUFF_FREE_MODEL_IDS].sort());
    expect(models).toHaveLength(6);
  });

  it("carries only upstream-live free rows (#137)", () => {
    // Withdrawn 2026-08-20 → 2026-09-07 (upstream FREEBUFF_PAUSED_FREE_MODEL_IDS)
    // or paywalled/god-only — none may appear as a selectable row.
    const slugs = freebuffSnapshotModels().map((model) => model.slug);
    for (const dead of [
      "stealth/ox-alpha",
      "google/gemini-3.8-flash",
      "meta/muse-spark-1.3-contributor",
      "minimax/minimax-m3",
      "deepseek/deepseek-v4-pro",
      "z-ai/glm-5.2",
      "crof/kimi-k3-eco",
      "openai/gpt-5.6-luna-es",
    ]) {
      expect(slugs).not.toContain(dead);
    }
    // The 1.2 replacement that took 1.3's slot on 2026-09-07.
    expect(slugs).toContain("meta/muse-spark-1.2-contributor");
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
    expect(namesBySlug.get("openai/gpt-5.6-luna")).toBe("GPT-5.6 Luna");
    expect(namesBySlug.get("mimo/mimo-v2.5")).toBe("MiMo 2.6 Flash");
    expect(namesBySlug.get("upstage/solar-pro4")).toBe("Solar Pro 4");
    expect(namesBySlug.get("meta/muse-spark-1.2-contributor")).toBe("Muse Spark 1.2");
  });

  it("marks every row built-in with no capability descriptors", () => {
    for (const model of freebuffSnapshotModels()) {
      expect(model.isCustom).toBe(false);
      expect(model.capabilities).toBeNull();
      expect(model.isLegacy).toBeUndefined();
    }
  });
});
