import { describe, expect, it } from "vite-plus/test";

import { ProviderDriverKind } from "@t3tools/contracts";

import { resolveLockedModelBlock } from "./modelLockedRow.logic";

const FREEBUFF = ProviderDriverKind.make("freebuff");
const CODEX = ProviderDriverKind.make("codex");

const MODELS = [
  { slug: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
  { slug: "mimo/mimo-v2.5", name: "MiMo 2.6 Flash" },
  { slug: "openai/gpt-6-luna", name: "GPT-6 Luna" },
  { slug: "mimo/mimo-v2.6-pro", name: "MiMo 2.6 Pro" },
  { slug: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash" },
];

describe("resolveLockedModelBlock", () => {
  it("blocks a tier-locked pick on the freebuff driver with the upstream line", () => {
    // Upstream freebuffPlanRequired doctrine: LISTED, not hidden — the row
    // stays in the picker (as a locked/legacy row) but selection and send
    // are refused with the same sentence the row displays.
    for (const slug of [
      "openai/gpt-6-luna",
      "mimo/mimo-v2.6-pro",
      "google/gemini-3.8-flash",
    ]) {
      const block = resolveLockedModelBlock({ driverKind: FREEBUFF, model: slug, models: MODELS });
      expect(block?.line, slug).toMatch(/paid plan/i);
      expect(block?.modelName, slug).toBeTruthy();
    }
  });

  it("names the model in the block reason", () => {
    const block = resolveLockedModelBlock({
      driverKind: FREEBUFF,
      model: "openai/gpt-6-luna",
      models: MODELS,
    });
    expect(block?.modelName).toBe("GPT-6 Luna");
    expect(block?.line).toContain("GPT-6 Luna");
  });

  it("never blocks servable rows, unknown rows, or other drivers", () => {
    for (const slug of ["z-ai/glm-5.3-flash", "mimo/mimo-v2.5", "acme/nonexistent"]) {
      expect(
        resolveLockedModelBlock({ driverKind: FREEBUFF, model: slug, models: MODELS }),
        slug,
      ).toBeNull();
    }
    expect(
      resolveLockedModelBlock({ driverKind: CODEX, model: "openai/gpt-6-luna", models: MODELS }),
    ).toBeNull();
  });

  it("still blocks when the picker list lost the row (sticky picks from older binaries)", () => {
    // A 0.0.38 binary could hold gpt-6-luna as its sticky pick; a snapshot
    // without the row must not wave the send through.
    const block = resolveLockedModelBlock({
      driverKind: FREEBUFF,
      model: "openai/gpt-6-luna",
      models: undefined,
    });
    expect(block).not.toBeNull();
    expect(block?.line).toMatch(/paid plan/i);
  });

  it("the SERVER's per-viewer verdict wins over the static census when present", () => {
    // Upstream freebuffPlanRequired: the decision turns on the access tier
    // (and once, the country) — a client deciding for itself would be
    // reading its own belief. planRequiredModelIds present = authoritative.
    // A slug the static census never locked can be locked for THIS viewer...
    const widened = resolveLockedModelBlock({
      driverKind: FREEBUFF,
      model: "upstage/solar-mini4",
      models: MODELS,
      planRequiredModelIds: ["upstage/solar-mini4"],
    });
    expect(widened).not.toBeNull();
    expect(widened?.line).toMatch(/paid plan/i);
    // ...and a static-census lock can be LIFTED for a viewer the server
    // says may open the row.
    const lifted = resolveLockedModelBlock({
      driverKind: FREEBUFF,
      model: "openai/gpt-6-luna",
      models: MODELS,
      planRequiredModelIds: [],
    });
    expect(lifted).toBeNull();
  });

  it("an absent server verdict falls back to the static census (old-server law)", () => {
    // Upstream: absent means "fall back to the static paid-only list" —
    // what every client did before the field existed.
    expect(
      resolveLockedModelBlock({
        driverKind: FREEBUFF,
        model: "openai/gpt-6-luna",
        models: MODELS,
        planRequiredModelIds: undefined,
      }),
    ).not.toBeNull();
    expect(
      resolveLockedModelBlock({
        driverKind: FREEBUFF,
        model: "mimo/mimo-v2.5",
        models: MODELS,
        planRequiredModelIds: undefined,
      }),
    ).toBeNull();
  });
});
