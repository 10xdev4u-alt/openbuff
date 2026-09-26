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

  it("LOCKED rows: listed, locked by census OR server verdict, admissible, consent moot", () => {
    for (const slug of FREEBUFF_PLAN_REQUIRED_MODEL_SLUGS_ORDERED) {
      // Locked ≠ inadmissible (#166 doctrine, corrected by the server-verdict
      // port): upstream keeps tier-locked rows in its pairing map — an
      // entitled viewer runs the real model; the lock is per-viewer.
      expect(slug in FREEBUFF_FREE_AGENT_BY_MODEL, `${slug} must stay admissible`).toBe(true);
      expect(FREEBUFF_FREE_PICKER_MODEL_IDS.includes(slug), `${slug} must not be a fresh pick`).toBe(
        false,
      );
      // Static census fallback locks the row...
      const censusLock = resolveLockedModelBlock({
        driverKind: "freebuff",
        model: slug,
        models: MODELS,
      });
      expect(censusLock, slug).not.toBeNull();
      expect(censusLock?.line, slug).toMatch(/paid plan/i);
      // ...and the server verdict is authoritative in BOTH directions.
      expect(
        resolveLockedModelBlock({
          driverKind: "freebuff",
          model: slug,
          models: MODELS,
          planRequiredModelIds: [],
        }),
        `${slug}: server lift wins`,
      ).toBeNull();
      // The send path consults the lock BEFORE the consent gate, so a locked
      // row must never ask a consent question its lock already answered.
      const consent = resolveDataUseConsentForSend({ model: slug, models: MODELS });
      expect(consent.action, slug).toBe("proceed");
    }
  });

  it("SERVER VERDICT: a widened lock reaches a servable row the census never locked", () => {
    // The reason the verdict exists: the gate turns on the resolved access
    // tier (and once, the country) — only the server knows. A per-viewer
    // lock on a census-unlocked slug must render exactly like a census one.
    const widened = resolveLockedModelBlock({
      driverKind: "freebuff",
      model: "upstage/solar-mini4",
      models: MODELS,
      planRequiredModelIds: ["upstage/solar-mini4"],
    });
    expect(widened).not.toBeNull();
    expect(widened?.line).toMatch(/paid plan/i);
  });

  it("DRAINED rows (admissible, not fresh picks, not locked): currently none — class rule pinned", () => {
    // The admissible set now = picker rows + tier-locked rows; a drain row
    // (picker-retired but NOT paused, like solar-pro4 was 09-23→09-25) would
    // land here. The class law: servable as-is, never locked, consented per
    // the journal like any servable row.
    const drained = Object.keys(FREEBUFF_FREE_AGENT_BY_MODEL).filter(
      (slug) =>
        !FREEBUFF_FREE_PICKER_MODEL_IDS.includes(slug) &&
        !FREEBUFF_PLAN_REQUIRED_MODEL_SLUGS_ORDERED.includes(slug),
    );
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
    // The forbidden pair is locked ∧ FRESHLY SELECTABLE (offer-without-
    // gate); a locked slug may be admissible (entitled viewers run the
    // real model), and the picker list never contains a locked slug.
    for (const locked of FREEBUFF_PLAN_REQUIRED_MODEL_SLUGS_ORDERED) {
      expect(FREEBUFF_FREE_PICKER_MODEL_IDS.includes(locked), locked).toBe(false);
      expect(locked in FREEBUFF_FREE_AGENT_BY_MODEL, locked).toBe(true);
    }
    for (const slug of FREEBUFF_FREE_PICKER_MODEL_IDS) {
      expect(slug in FREEBUFF_FREE_AGENT_BY_MODEL, slug).toBe(true);
      expect(FREEBUFF_PLAN_REQUIRED_MODEL_SLUGS_ORDERED.includes(slug), slug).toBe(false);
    }
  });
});
