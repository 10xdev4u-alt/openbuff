import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_FREEBUFF_FREE_MODEL,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
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
