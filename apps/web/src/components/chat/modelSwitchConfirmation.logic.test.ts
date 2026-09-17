import { describe, expect, it } from "vite-plus/test";

import { resolveModelSwitchConfirmation } from "./modelSwitchConfirmation.logic.ts";

describe("resolveModelSwitchConfirmation", () => {
  it("proceeds without confirmation when no session has started", () => {
    expect(
      resolveModelSwitchConfirmation({
        hasStartedSession: false,
        driver: "freebuff",
        currentModel: undefined,
        nextModel: "z-ai/glm-5.2",
        models: [],
      }),
    ).toEqual({ action: "proceed" });
  });

  it("proceeds for non-freebuff drivers — other providers have no seat to release", () => {
    expect(
      resolveModelSwitchConfirmation({
        hasStartedSession: true,
        driver: "openai",
        currentModel: "gpt-5.6",
        nextModel: "gpt-5.7",
        models: [],
      }),
    ).toEqual({ action: "proceed" });
  });

  it("cancels the no-op switch (same model on a live freebuff session)", () => {
    expect(
      resolveModelSwitchConfirmation({
        hasStartedSession: true,
        driver: "freebuff",
        currentModel: "deepseek/deepseek-v4-flash",
        nextModel: "deepseek/deepseek-v4-flash",
        models: [],
      }),
    ).toEqual({ action: "cancel" });
  });

  it("requires confirmation for a real switch and names both models", () => {
    const decision = resolveModelSwitchConfirmation({
      hasStartedSession: true,
      driver: "freebuff",
      currentModel: "deepseek/deepseek-v4-flash",
      nextModel: "z-ai/glm-5.2",
      models: [
        { slug: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
        { slug: "z-ai/glm-5.2", name: "GLM 5.2" },
      ],
    });
    if (decision.action !== "confirm") {
      throw new Error(`expected confirm, got ${decision.action}`);
    }
    expect(decision.message).toContain("DeepSeek V4 Flash");
    expect(decision.message).toContain("GLM 5.2");
    expect(decision.message).toContain("stops the current");
  });

  it("falls back to slugs when display names are unavailable", () => {
    const decision = resolveModelSwitchConfirmation({
      hasStartedSession: true,
      driver: "freebuff",
      currentModel: "deepseek/deepseek-v4-flash",
      nextModel: "z-ai/glm-5.2",
      models: undefined,
    });
    if (decision.action !== "confirm") {
      throw new Error(`expected confirm, got ${decision.action}`);
    }
    expect(decision.message).toContain("deepseek/deepseek-v4-flash");
    expect(decision.message).toContain("z-ai/glm-5.2");
  });

  it("speaks generically when the current model is unknown", () => {
    const decision = resolveModelSwitchConfirmation({
      hasStartedSession: true,
      driver: "freebuff",
      currentModel: undefined,
      nextModel: "z-ai/glm-5.2",
      models: [],
    });
    if (decision.action !== "confirm") {
      throw new Error(`expected confirm, got ${decision.action}`);
    }
    expect(decision.message).toContain("the current model");
  });
});
