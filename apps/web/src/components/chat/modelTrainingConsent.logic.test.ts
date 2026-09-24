import { describe, expect, it } from "vite-plus/test";

import { resolveTrainingDataConsent } from "./modelTrainingConsent.logic";

const MODELS = [
  { slug: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
  { slug: "meta/muse-spark-1.2-contributor", name: "Muse Spark 1.2" },
];

describe("resolveTrainingDataConsent", () => {
  it("proceeds without a dialog for non-training rows", () => {
    expect(resolveTrainingDataConsent({ nextModel: "z-ai/glm-5.3-flash", models: MODELS })).toEqual({
      action: "proceed",
    });
  });

  it("demands consent for the training row, naming the model", () => {
    const decision = resolveTrainingDataConsent({
      nextModel: "meta/muse-spark-1.2-contributor",
      models: MODELS,
    });
    expect(decision.action).toBe("confirm");
    if (decision.action === "confirm") {
      expect(decision.message).toContain("Muse Spark 1.2");
      expect(decision.message).toMatch(/trains on your prompts/i);
    }
  });

  it("refuses to wave the row through when the picker lost it", () => {
    const decision = resolveTrainingDataConsent({
      nextModel: "meta/muse-spark-1.2-contributor",
      models: undefined,
    });
    expect(decision.action).toBe("cancel");
  });
});
