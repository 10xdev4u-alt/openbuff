import { describe, expect, it } from "vite-plus/test";

import { resolveDataUseConsent } from "./modelDataUseConsent.logic";

const MODELS = [
  { slug: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
  { slug: "meta/muse-spark-1.2-contributor", name: "Muse Spark 1.2" },
  { slug: "stealth/space-bunny-alpha", name: "Space Bunny Alpha" },
];

describe("resolveDataUseConsent", () => {
  it("proceeds without a dialog for undisclosed rows", () => {
    for (const slug of ["z-ai/glm-5.3-flash", "openai/gpt-6-luna", "upstage/solar-mini4"]) {
      expect(resolveDataUseConsent({ nextModel: slug, models: MODELS })).toEqual({
        action: "proceed",
      });
    }
  });

  it("demands consent for the training row, naming the model and the grant", () => {
    const decision = resolveDataUseConsent({
      nextModel: "meta/muse-spark-1.2-contributor",
      models: MODELS,
    });
    expect(decision.action).toBe("confirm");
    if (decision.action === "confirm") {
      expect(decision.message).toContain("Muse Spark 1.2");
      expect(decision.message).toMatch(/trains on your prompts/i);
    }
  });

  it("demands consent for the retention row with TRAINING-DISTINCT copy", () => {
    const decision = resolveDataUseConsent({
      nextModel: "stealth/space-bunny-alpha",
      models: MODELS,
    });
    expect(decision.action).toBe("confirm");
    if (decision.action === "confirm") {
      expect(decision.message).toContain("Space Bunny Alpha");
      expect(decision.message).toMatch(/retains your prompts/i);
      // The two disclosures must not blur: retention says it does NOT train.
      expect(decision.message).toMatch(/does not train/i);
    }
  });

  it("refuses to wave a disclosed row through when the picker lost it", () => {
    for (const slug of ["meta/muse-spark-1.2-contributor", "stealth/space-bunny-alpha"]) {
      const decision = resolveDataUseConsent({ nextModel: slug, models: undefined });
      expect(decision.action, slug).toBe("cancel");
    }
  });
});
