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
  it("pins the freebuff free model (mirrors the server-side pin)", () => {
    expect(DEFAULT_FREEBUFF_FREE_MODEL).toBe("deepseek/deepseek-v4-flash");
  });

  it("maps the freebuff driver to the free pin", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER[FREEBUFF_DRIVER_KIND]).toBe(
      "deepseek/deepseek-v4-flash",
    );
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
  it("carries exactly the eight upstream free-tier pairings", () => {
    expect(Object.keys(FREEBUFF_FREE_AGENT_BY_MODEL).sort()).toEqual(
      [
        "crof/kimi-k3-eco",
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4-pro",
        "minimax/minimax-m3",
        "mimo/mimo-v2.5",
        "openai/gpt-5.6-luna",
        "z-ai/glm-5.2",
        "z-ai/glm-5.3-flash",
      ].sort(),
    );
  });

  it("pairs each model with the upstream agent root", () => {
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["deepseek/deepseek-v4-pro"]).toBe("base3-free-deepseek");
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["deepseek/deepseek-v4-flash"]).toBe(
      "base3-free-deepseek-flash",
    );
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["mimo/mimo-v2.5"]).toBe("base3-free-mimo");
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["minimax/minimax-m3"]).toBe("base3-free-minimax-m3");
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["openai/gpt-5.6-luna"]).toBe("base3-free-luna");
    expect(FREEBUFF_FREE_AGENT_BY_MODEL["z-ai/glm-5.2"]).toBe("base3-free-glm");
  });

  it("exposes every map key as a selectable model id", () => {
    expect([...FREEBUFF_FREE_MODEL_IDS].sort()).toEqual(
      Object.keys(FREEBUFF_FREE_AGENT_BY_MODEL).sort(),
    );
  });
});

describe("resolveFreebuffAgentForModel", () => {
  it("resolves a known model to its paired agent", () => {
    expect(resolveFreebuffAgentForModel("z-ai/glm-5.2")).toBe("base3-free-glm");
    expect(resolveFreebuffAgentForModel("z-ai/glm-5.3-flash")).toBe("base3-free-glm-5-3-flash");
  });

  it("falls back to the free pin's agent for unknown models", () => {
    expect(resolveFreebuffAgentForModel("acme/nonexistent")).toBe(
      "base3-free-deepseek-flash",
    );
  });

  it("falls back when the selection is absent", () => {
    expect(resolveFreebuffAgentForModel(undefined)).toBe("base3-free-deepseek-flash");
  });
});
