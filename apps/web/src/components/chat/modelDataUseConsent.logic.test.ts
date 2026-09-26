import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  resolveDataUseConsent,
  resolveDataUseConsentForSend,
} from "./modelDataUseConsent.logic";
import {
  clearConsentedDataUseModelSlugs,
  readConsentedDataUseModelSlugs,
  rememberConsentedDataUseModelSlug,
} from "./modelDataUseConsent.storage";

const MODELS = [
  { slug: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
  { slug: "meta/muse-spark-1.2-contributor", name: "Muse Spark 1.2" },
  { slug: "stealth/space-bunny-alpha", name: "Space Bunny Alpha" },
];

// Same stubbed-storage idiom as clientPersistenceStorage.test.ts: a Map-backed
// Storage so the consent journal's fail-closed paths are testable in a node
// environment.
function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function getTestWindow(): { localStorage: Storage } {
  const localStorage = createLocalStorageStub();
  const testWindow = { localStorage } as unknown as Window & typeof globalThis;
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("localStorage", localStorage);
  return { localStorage };
}

/** Drop a raw value straight into the consent journal's storage slot. */
function seedRawConsentStorage(localStorage: Storage, value: unknown): void {
  localStorage.setItem(
    "t3code:data-use-consents:v1",
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

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

describe("resolveDataUseConsentForSend", () => {
  beforeEach(() => {
    getTestWindow();
  });

  afterEach(() => {
    clearConsentedDataUseModelSlugs();
    vi.unstubAllGlobals();
  });

  it("asks on a fresh thread's first send when the composer already sits on the training row (#157)", () => {
    const decision = resolveDataUseConsentForSend({
      model: "meta/muse-spark-1.2-contributor",
      models: MODELS,
    });
    expect(decision).toEqual({
      action: "confirm",
      message: expect.stringContaining("Muse Spark 1.2"),
    });
    if (decision.action === "confirm") {
      expect(decision.message).toMatch(/trains on your prompts/i);
    }
  });

  it("asks on a fresh thread's first send when the composer already sits on the retention row (#157)", () => {
    const decision = resolveDataUseConsentForSend({
      model: "stealth/space-bunny-alpha",
      models: MODELS,
    });
    expect(decision.action).toBe("confirm");
    if (decision.action === "confirm") {
      // The send-path gate must carry the SAME training-distinct copy as the
      // switch gate — the disclosures must not blur across paths either.
      expect(decision.message).toMatch(/retains your prompts/i);
      expect(decision.message).toMatch(/does not train/i);
    }
  });

  it("never asks for undisclosed rows, even with no consent state at all", () => {
    for (const slug of ["z-ai/glm-5.3-flash", "openai/gpt-6-luna", "upstage/solar-mini4"]) {
      expect(resolveDataUseConsentForSend({ model: slug, models: MODELS })).toEqual({
        action: "proceed",
      });
    }
    expect(
      resolveDataUseConsentForSend({ model: "z-ai/glm-5.3-flash", models: undefined }),
    ).toEqual({ action: "proceed" });
  });

  it("does not ask again once the model has been consented — including across restarts", () => {
    rememberConsentedDataUseModelSlug("meta/muse-spark-1.2-contributor");
    expect(
      resolveDataUseConsentForSend({
        model: "meta/muse-spark-1.2-contributor",
        models: MODELS,
      }),
    ).toEqual({ action: "proceed" });

    // Persistence shape: the slug survives a round-trip through storage.
    expect(readConsentedDataUseModelSlugs()).toContain("meta/muse-spark-1.2-contributor");
  });

  it("tracks the two disclosed rows independently", () => {
    rememberConsentedDataUseModelSlug("meta/muse-spark-1.2-contributor");
    const decision = resolveDataUseConsentForSend({
      model: "stealth/space-bunny-alpha",
      models: MODELS,
    });
    expect(decision.action).toBe("confirm");
  });

  it("cancel is sticky until the user explicitly consents — the ask cannot be waited out", () => {
    // A decline records nothing, so the next send hits the gate again.
    expect(
      resolveDataUseConsentForSend({ model: "meta/muse-spark-1.2-contributor", models: MODELS })
        .action,
    ).toBe("confirm");
    expect(readConsentedDataUseModelSlugs()).toEqual([]);
    expect(
      resolveDataUseConsentForSend({ model: "meta/muse-spark-1.2-contributor", models: MODELS })
        .action,
    ).toBe("confirm");
  });

  it("still waves a consented row through when the picker lost it (consent precedes disclosure loss)", () => {
    rememberConsentedDataUseModelSlug("meta/muse-spark-1.2-contributor");
    expect(
      resolveDataUseConsentForSend({
        model: "meta/muse-spark-1.2-contributor",
        models: undefined,
      }),
    ).toEqual({ action: "proceed" });
  });

  it("corrupt or legacy storage cannot turn a disclosed row into a silent proceed", () => {
    const { localStorage } = getTestWindow();
    seedRawConsentStorage(localStorage, { notAnArray: true });
    const decision = resolveDataUseConsentForSend({
      model: "meta/muse-spark-1.2-contributor",
      models: MODELS,
    });
    expect(decision.action).toBe("confirm");
  });
});

describe("consent storage helper", () => {
  beforeEach(() => {
    getTestWindow();
  });

  afterEach(() => {
    clearConsentedDataUseModelSlugs();
    vi.unstubAllGlobals();
  });

  it("persists each consented slug exactly once and dedupes", () => {
    rememberConsentedDataUseModelSlug("meta/muse-spark-1.2-contributor");
    rememberConsentedDataUseModelSlug("meta/muse-spark-1.2-contributor");
    expect(readConsentedDataUseModelSlugs()).toEqual(["meta/muse-spark-1.2-contributor"]);
  });

  it("ignores garbage entries read from storage", () => {
    const { localStorage } = getTestWindow();
    seedRawConsentStorage(localStorage, ["meta/muse-spark-1.2-contributor", 42, null, {}]);
    expect(readConsentedDataUseModelSlugs()).toEqual(["meta/muse-spark-1.2-contributor"]);
  });

  it("reads as never-consented when storage is unavailable", () => {
    vi.stubGlobal("window", undefined as unknown as Window & typeof globalThis);
    expect(readConsentedDataUseModelSlugs()).toEqual([]);
    expect(() =>
      rememberConsentedDataUseModelSlug("meta/muse-spark-1.2-contributor"),
    ).not.toThrow();
  });
});
