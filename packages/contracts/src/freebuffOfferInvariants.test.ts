import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_FREEBUFF_FREE_MODEL } from "./model.ts";
import { freebuffOfferViolations } from "./freebuffOfferInvariants.ts";

const PICKER = {
  surface: "freebuff picker (fresh)",
  offered: [
    "z-ai/glm-5.3-flash",
    "deepseek/deepseek-v4-flash",
    "mimo/mimo-v2.5",
    "upstage/solar-mini4",
    "upstage/solar-pro4",
    "stealth/space-bunny-alpha",
    "meta/muse-spark-1.2-contributor",
  ],
};

describe("freebuffOfferViolations", () => {
  it("the live picker surface is clean", () => {
    expect(freebuffOfferViolations(PICKER)).toEqual([]);
  });

  it("an empty offer set is a wiring error, not a pass", () => {
    const out = freebuffOfferViolations({ surface: "broken wiring", offered: [] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/check the test wiring/);
  });

  it("CHECK 1: an id outside the pairing map is caught", () => {
    const out = freebuffOfferViolations({
      surface: "drifted surface",
      offered: [DEFAULT_FREEBUFF_FREE_MODEL, "acme/never-heard-of-it"],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/admission pairing map has no row/);
  });

  it("CHECK 2: a locked row offered as a FRESH pick is caught (offer-without-gate)", () => {
    const out = freebuffOfferViolations({
      surface: "drifted picker",
      offered: [DEFAULT_FREEBUFF_FREE_MODEL, "openai/gpt-6-luna"],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/fresh selection but the tier's admission locks it/);
  });

  it("CHECK 2 exception: the LISTED surface may carry locked rows (it skips the lock check)", () => {
    const out = freebuffOfferViolations({
      surface: "freebuff picker (listed, locked rows included)",
      offered: [DEFAULT_FREEBUFF_FREE_MODEL, "openai/gpt-6-luna", "google/gemini-3.8-flash"],
      freshSelections: false,
      // Every row must still pass the other checks.
      nameFor: (model) => (model.includes("/") ? model.split("/")[1] : undefined),
    });
    expect(out).toEqual([]);
  });

  it("CHECK 3: a coerced pick is caught — the resolver must serve what was offered", () => {
    // Simulate the #152 shape by offering an id the map cannot serve: the
    // known dead model must come back as a coercion violation, not silence.
    const out = freebuffOfferViolations({
      surface: "coercing surface",
      offered: [DEFAULT_FREEBUFF_FREE_MODEL, "openai/gpt-5.6-luna"],
    });
    expect(out).toEqual([
      expect.stringMatching(/pairing map has no row/),
    ]);
  });

  it("CHECK 4: the default-root coercion check cannot fire while the map is pinned", () => {
    // Since the pairing map carries every row's OWN root (pinned by the
    // model.test pairings), a live-surface drift on gpt-6-luna produces
    // exactly the lock violation — the root check correctly passes because
    // the row resolves to base3-free-luna-6. The root check's teeth are for
    // a FUTURE map edit that points a row at the default root; the map pins
    // in model.test.ts are its duplicate defense.
    const out = freebuffOfferViolations({
      surface: "double-drift",
      offered: [DEFAULT_FREEBUFF_FREE_MODEL, "openai/gpt-6-luna"],
    });
    expect(out).toEqual([expect.stringMatching(/locks it/)]);
  });

  it("CHECK 5: a missing display name renders the fallback label and is caught", () => {
    const out = freebuffOfferViolations({
      surface: "unnamed surface",
      offered: [DEFAULT_FREEBUFF_FREE_MODEL],
      nameFor: () => undefined,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/no display name/);
  });

  it("a nameless surface skips CHECK 5 entirely (opt-in check)", () => {
    expect(freebuffOfferViolations({ surface: "no catalog", offered: [DEFAULT_FREEBUFF_FREE_MODEL] })).toEqual([]);
  });

  it("CHECK 5b: a WRONG label (another row's name) is caught by the expected lookup", () => {
    // The GLM 5.2 Desktop shape upstream: the row rendered under the
    // FALLBACK's label — wrong, not missing; every missing-name check
    // passes it. Only the independent expected lookup sees it.
    const out = freebuffOfferViolations({
      surface: "mislabeled surface",
      offered: [DEFAULT_FREEBUFF_FREE_MODEL],
      nameFor: () => "DeepSeek V4.1 Flash",
      expectedNameFor: () => "GLM 5.3 Flash",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/fallback-label shape/);
    expect(out[0]).toContain("DeepSeek V4.1 Flash");
    expect(out[0]).toContain("GLM 5.3 Flash");
  });
});
