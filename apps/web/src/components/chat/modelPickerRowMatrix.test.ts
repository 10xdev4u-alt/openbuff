import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  FREEBUFF_FREE_AGENT_BY_MODEL,
  FREEBUFF_FREE_PICKER_MODEL_IDS,
  FREEBUFF_PLAN_REQUIRED_MODEL_SLUGS_ORDERED,
} from "@t3tools/contracts";

import { resolveDataUseConsentForSend } from "./modelDataUseConsent.logic";
import {
  clearConsentedDataUseModelSlugs,
  rememberConsentedDataUseModelSlug,
} from "./modelDataUseConsent.storage";
import { freebuffPickerDisclosureFor } from "./modelPickerDisclosures";
import { resolveLockedModelBlock } from "./modelLockedRow.logic";

/**
 * The picker row-matrix audit (post-#166): one table walking every row class
 * the freebuff picker can hold — SERVABLE (picker rows), LOCKED
 * (plan-gated, listed not hidden), DRAINED (admissible but not freshly
 * selectable) — asserting what each layer answers, so a future roster change
 * cannot satisfy one test while violating another.
 */
function stubStorage(): void {
  const store = new Map<string, string>();
  const localStorage: Storage = {
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
  vi.stubGlobal("window", { localStorage } as unknown as Window & typeof globalThis);
  vi.stubGlobal("localStorage", localStorage);
}

const MODELS = [
  ...FREEBUFF_FREE_PICKER_MODEL_IDS.map((slug) => ({
    slug,
    name: slug.split("/")[1] ?? slug,
  })),
  ...FREEBUFF_PLAN_REQUIRED_MODEL_SLUGS_ORDERED.map((slug) => ({
    slug,
    name: slug.split("/")[1] ?? slug,
  })),
];

describe("picker row-matrix audit", () => {
  beforeEach(() => {
    stubStorage();
  });
  afterEach(() => {
    clearConsentedDataUseModelSlugs();
    vi.unstubAllGlobals();
  });

  it("SERVABLE rows: never locked, disclosed exactly when the sets say, consent before first send", () => {
    for (const slug of FREEBUFF_FREE_PICKER_MODEL_IDS) {
      expect(slug in FREEBUFF_FREE_AGENT_BY_MODEL, slug).toBe(true);
      expect(
        resolveLockedModelBlock({ driverKind: "freebuff", model: slug, models: MODELS }),
        slug,
      ).toBeNull();

      const disclosure = freebuffPickerDisclosureFor(slug);
      const unconstrained = resolveDataUseConsentForSend({ model: slug, models: MODELS });
      if (disclosure === undefined) {
        expect(unconstrained.action, `${slug}: undisclosed must proceed`).toBe("proceed");
      } else {
        expect(unconstrained.action, `${slug}: disclosed must ask`).toBe("confirm");
        expect(disclosure.title.length, slug).toBeGreaterThan(0);
      }

      rememberConsentedDataUseModelSlug(slug);
      const consented = resolveDataUseConsentForSend({ model: slug, models: MODELS });
      expect(consented.action, `${slug}: journal must silence the ask`).toBe("proceed");
    }
  });

  it("LOCKED rows: listed, locked, never servable, never consent-gated (the lock answers first)", () => {
    for (const slug of FREEBUFF_PLAN_REQUIRED_MODEL_SLUGS_ORDERED) {
      expect(slug in FREEBUFF_FREE_AGENT_BY_MODEL, `${slug} must not be servable`).toBe(false);
      const lock = resolveLockedModelBlock({ driverKind: "freebuff", model: slug, models: MODELS });
      expect(lock, slug).not.toBeNull();
      expect(lock?.line, slug).toMatch(/paid plan/i);
      // The send path consults the lock BEFORE the consent gate, so a locked
      // row must never ask a consent question its lock already answered.
      const consent = resolveDataUseConsentForSend({ model: slug, models: MODELS });
      expect(consent.action, slug).toBe("proceed");
    }
  });

  it("DRAINED rows (admissible, not freshly selectable): servable + consented, never locked", () => {
    const drained = Object.keys(FREEBUFF_FREE_AGENT_BY_MODEL).filter(
      (slug) => !FREEBUFF_FREE_PICKER_MODEL_IDS.includes(slug),
    );
    // Currently empty (the 09-25 reshape returned pro4); the class rule is
    // pinned so the next drain row inherits the law automatically.
    for (const slug of drained) {
      expect(
        resolveLockedModelBlock({ driverKind: "freebuff", model: slug, models: MODELS }),
        `${slug} drained must not be locked`,
      ).toBeNull();
      const unconstrained = resolveDataUseConsentForSend({ model: slug, models: MODELS });
      expect(["proceed", "confirm"], slug).toContain(unconstrained.action);
    }
  });

  it("the three classes partition the picker's whole world", () => {
    // No slug may be both servable and locked (offer-without-gate), and the
    // picker list is exactly the servable set minus drain rows.
    const servable = new Set(Object.keys(FREEBUFF_FREE_AGENT_BY_MODEL));
    for (const locked of FREEBUFF_PLAN_REQUIRED_MODEL_SLUGS_ORDERED) {
      expect(servable.has(locked), locked).toBe(false);
    }
    for (const slug of FREEBUFF_FREE_PICKER_MODEL_IDS) {
      expect(servable.has(slug), slug).toBe(true);
    }
  });
});
