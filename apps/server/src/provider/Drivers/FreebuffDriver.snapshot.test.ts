import { describe, expect, it } from "vite-plus/test";

import { FREEBUFF_FREE_MODEL_IDS } from "@t3tools/contracts";

import { freebuffSnapshotModels } from "./FreebuffDriver.ts";

describe("freebuffSnapshotModels", () => {
  it("serves exactly the eight allowlisted free-tier rows", () => {
    const models = freebuffSnapshotModels();
    expect(models.map((model) => model.slug).sort()).toEqual([...FREEBUFF_FREE_MODEL_IDS].sort());
    expect(models).toHaveLength(8);
  });

  it("pins the flash row as the tier default", () => {
    const flash = freebuffSnapshotModels().find(
      (model) => model.slug === "deepseek/deepseek-v4-flash",
    );
    expect(flash?.isDefault).toBe(true);
    expect(flash?.name).toBe("DeepSeek V4.1 Flash");
  });

  it("labels every row with the upstream display name", () => {
    const namesBySlug = new Map(
      freebuffSnapshotModels().map((model) => [model.slug, model.name] as const),
    );
    expect(namesBySlug.get("deepseek/deepseek-v4-pro")).toBe("DeepSeek V4 Pro");
    expect(namesBySlug.get("mimo/mimo-v2.5")).toBe("MiMo 2.5");
    expect(namesBySlug.get("minimax/minimax-m3")).toBe("MiniMax M3");
    expect(namesBySlug.get("openai/gpt-5.6-luna")).toBe("GPT-5.6 Luna");
    expect(namesBySlug.get("z-ai/glm-5.2")).toBe("GLM 5.2");
    expect(namesBySlug.get("z-ai/glm-5.3-flash")).toBe("GLM 5.3 Flash");
    expect(namesBySlug.get("crof/kimi-k3-eco")).toBe("Kimi K3");
  });

  it("marks every row built-in with no capability descriptors", () => {
    for (const model of freebuffSnapshotModels()) {
      expect(model.isCustom).toBe(false);
      expect(model.capabilities).toBeNull();
      expect(model.isLegacy).toBeUndefined();
    }
  });
});
