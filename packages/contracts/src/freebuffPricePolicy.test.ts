/**
 * Freebuff price-policy projection (issue #129) — ported invariants from
 * upstream's `common/src/util/__tests__/freebuff-price-changes.test.ts`:
 * boundary coherence without mutation, out-of-order catch-up, never invent
 * prices, midnight-crossing recurring windows, first-tab × policy
 * interaction, stale strike repair, idempotence.
 *
 * @module freebuffPricePolicy
 */
import { describe, expect, it } from "vite-plus/test";

import { applyFirstTabDiscount } from "./freebuffDiscount.ts";
import {
  applyFreebucksPriceChanges,
  nextFreebucksPriceChange,
  offPeakPriceAt,
  type FreebuffOffPeakPrice,
  type FreebuffPriceChange,
} from "./freebuffPricePolicy.ts";

const solar = "upstage/solar-pro4";

/** Upstream's SOLAR promo, inlined: free weekend → restored → metered → increased. */
const SOLAR_PRICE_CHANGES: readonly FreebuffPriceChange[] = [
  {
    at: "2026-09-05T07:00:00Z",
    modelId: solar,
    price: 0,
    tagline: "Labor Day weekend: 0 Freebucks",
  },
  { at: "2026-09-08T07:00:00Z", modelId: solar, price: 5, tagline: "Limited-time trial" },
  { at: "2026-09-09T15:49:00Z", modelId: solar, price: 0, tagline: "0 Freebucks" },
  { at: "2026-09-13T05:00:00Z", modelId: solar, price: 5, tagline: "Limited-time trial" },
  { at: "2026-09-14T03:46:00Z", modelId: solar, price: 10, tagline: "Price increase" },
];

const start = Date.parse("2026-09-05T07:00:00Z");
const end = Date.parse("2026-09-08T07:00:00Z");
const restored = Date.parse("2026-09-09T15:49:00Z");
const metered = Date.parse("2026-09-13T05:00:00Z");
const increased = Date.parse("2026-09-14T03:46:00Z");

function quoteBeforeStart() {
  return {
    balance: 7,
    prices: { [solar]: 5 },
    planId: null as string | null,
    priceNotices: { [solar]: "Limited-time trial" },
    priceChanges: [...SOLAR_PRICE_CHANGES],
  };
}

/** Upstream's flash off-peak policy: 22:00→06:00 UTC, crossing midnight. */
const flashPolicy: FreebuffOffPeakPrice = {
  startHourUtc: 22,
  endHourUtc: 6,
  price: 10,
  regularPrice: 15,
};

describe("announced price changes", () => {
  it("keeps a serialized quote coherent at every boundary without mutating balances or the input", () => {
    const quote = JSON.parse(JSON.stringify(quoteBeforeStart()));
    expect(applyFreebucksPriceChanges(quote, start - 1)).toBe(quote);
    const free = applyFreebucksPriceChanges(quote, start);
    expect(free.prices[solar]).toBe(0);
    expect(free.priceNotices?.[solar]).toContain("Labor Day weekend");
    expect(nextFreebucksPriceChange(free, start)).toBe(end);
    const expired = applyFreebucksPriceChanges(free, end);
    expect(expired.prices[solar]).toBe(5);
    expect(expired.priceNotices?.[solar]).toBe("Limited-time trial");
    expect(expired.balance).toBe(quote.balance);
    expect(nextFreebucksPriceChange(expired, end)).toBe(restored);
    const freeAgain = applyFreebucksPriceChanges(expired, restored);
    expect(freeAgain.prices[solar]).toBe(0);
    expect(freeAgain.priceNotices?.[solar]).toBe("0 Freebucks");
    const meteredAgain = applyFreebucksPriceChanges(freeAgain, metered);
    expect(meteredAgain.prices[solar]).toBe(5);
    expect(nextFreebucksPriceChange(meteredAgain, metered)).toBe(increased);
    expect(applyFreebucksPriceChanges(meteredAgain, increased - 1)).toBe(meteredAgain);
    expect(applyFreebucksPriceChanges(meteredAgain, increased).prices[solar]).toBe(10);
    expect(applyFreebucksPriceChanges(meteredAgain, increased).priceChanges).toEqual([]);
    // The input quote is never mutated.
    expect(quote.prices[solar]).toBe(5);
    expect(quote.priceChanges).toHaveLength(5);
  });

  it("catches up across all transitions, even when listed out of order", () => {
    const quote = quoteBeforeStart();
    quote.priceChanges = [...quote.priceChanges].reverse();
    expect(applyFreebucksPriceChanges(quote, end).prices[solar]).toBe(5);
    expect(applyFreebucksPriceChanges(quote, restored).prices[solar]).toBe(0);
    expect(applyFreebucksPriceChanges(quote, metered).prices[solar]).toBe(5);
    expect(applyFreebucksPriceChanges(quote, increased).prices[solar]).toBe(10);
  });

  it("does not add an unpriced model or invent metadata on older server responses", () => {
    const old = { balance: 0, prices: {} as Record<string, number>, planId: null as string | null };
    expect(applyFreebucksPriceChanges(old, end)).toBe(old);
    expect(nextFreebucksPriceChange(undefined, end)).toBe(Number.POSITIVE_INFINITY);
    const missing = {
      ...old,
      priceChanges: SOLAR_PRICE_CHANGES,
      offPeak: { [solar]: flashPolicy },
    };
    expect(applyFreebucksPriceChanges(missing, end).prices[solar]).toBeUndefined();
  });
});

describe("recurring off-peak windows", () => {
  it("resolves a midnight-crossing window at both boundaries", () => {
    const at = Date.parse("2026-09-18T23:00:00Z");
    const current = offPeakPriceAt(flashPolicy, at);
    expect(current.price).toBe(10); // off-peak 22→06
    expect(current.nextChangeAt).toBe(Date.parse("2026-09-19T06:00:00Z"));
    const peak = offPeakPriceAt(flashPolicy, Date.parse("2026-09-19T12:00:00Z"));
    expect(peak.price).toBe(15);
    expect(peak.nextChangeAt).toBe(Date.parse("2026-09-19T22:00:00Z"));
  });

  it("repairs an exhausted stale quote without touching the balance, idempotently", () => {
    const quote = {
      balance: 25,
      prices: { flash: 15 },
      planId: null as string | null,
      offPeak: { flash: flashPolicy },
      priceChanges: [] as readonly FreebuffPriceChange[],
    };
    const now = Date.parse("2026-09-18T22:00:00Z");
    const current = applyFreebucksPriceChanges(quote, now);
    expect(current.prices.flash).toBe(10); // window start = off-peak active (upstream table)
    const later = applyFreebucksPriceChanges(quote, now + 8 * 3_600_000);
    expect(later.prices.flash).toBe(15); // 06:00 boundary = peak returns
    expect(later.balance).toBe(quote.balance);
    expect(quote.prices.flash).toBe(15); // input untouched
    expect(applyFreebucksPriceChanges(later, now + 8 * 3_600_000)).toBe(later);
    expect(nextFreebucksPriceChange(current, now)).toBe(now + 8 * 3_600_000);
  });

  it("interacts with an available first-tab discount and repairs a stale strike", () => {
    const quote = {
      balance: 25,
      prices: { flash: 15 },
      planId: null as string | null,
      offPeak: { flash: flashPolicy },
      priceChanges: [] as readonly FreebuffPriceChange[],
    };
    const now = Date.parse("2026-09-18T23:00:00Z"); // off-peak active
    const discounted = applyFirstTabDiscount(quote, { amount: 10, available: true });
    const firstTab = applyFreebucksPriceChanges(discounted, now);
    expect(firstTab.prices.flash).toBe(0); // 10 off-peak − 10 discount
    expect(firstTab.listPrices?.flash).toBe(10); // raw policy price as strike
    expect(applyFreebucksPriceChanges(firstTab, now)).toBe(firstTab);
    // Withdraw the discount: raw policy price returns.
    expect(applyFirstTabDiscount(firstTab, { amount: 10, available: false }).prices.flash).toBe(10);
    // A stale crossed-out price still needs repair when the payable price is current.
    expect(
      applyFreebucksPriceChanges({ ...firstTab, listPrices: { flash: 15 } }, now).listPrices?.flash,
    ).toBe(10);
  });
});
