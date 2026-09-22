import { describe, expect, it } from "vite-plus/test";

import type { FreebuffProviderFreebucks } from "@t3tools/contracts";

import { freebuffPickerPricingForInstance } from "./modelPickerPricing.ts";

/** Upstream's flash off-peak policy: 22:00→06:00 UTC, crossing midnight. */
const FLASH_POLICY = {
  startHourUtc: 22,
  endHourUtc: 6,
  price: 10,
  regularPrice: 15,
};

function quote(fields: Partial<FreebuffProviderFreebucks>): FreebuffProviderFreebucks {
  return {
    balance: 7,
    daily: { limit: 30, spent: 3, remaining: 27, resetAt: "2026-09-24T00:00:00Z" },
    wallet: { balance: 4, monthlyBonus: 0 },
    planId: null,
    prices: { "vendor/premium": 15, "vendor/cheap": 5, "vendor/free": 0 },
    ...fields,
  };
}

const SLUGS = ["vendor/premium", "vendor/cheap", "vendor/free", "vendor/unpriced"];

describe("freebuffPickerPricingForInstance", () => {
  it("absent or null freebucks yields an empty map — nothing fabricated", () => {
    expect(freebuffPickerPricingForInstance(undefined, SLUGS).size).toBe(0);
    // `null` = meter exists but refresh failed; same treatment.
    expect(freebuffPickerPricingForInstance(null, SLUGS).size).toBe(0);
  });

  it("an available offer yields discounted prices with list strike targets", () => {
    const pricing = freebuffPickerPricingForInstance(
      quote({
        prices: { "vendor/premium": 15, "vendor/cheap": 5 },
        listPrices: { "vendor/premium": 25, "vendor/cheap": 5 },
        firstTabDiscount: { amount: 10, available: true },
      }),
      SLUGS,
    );
    expect(pricing.get("vendor/premium")).toEqual({ price: 15, listPrice: 25 });
    // Discount did not move this row: price only, no strike ("0 off 0" is not a discount).
    expect(pricing.get("vendor/cheap")).toEqual({ price: 5 });
    // Unpriced rows are omitted, never invented.
    expect(pricing.has("vendor/unpriced")).toBe(false);
  });

  it("an in-use offer yields raw prices with no strike targets", () => {
    const pricing = freebuffPickerPricingForInstance(
      quote({
        prices: { "vendor/premium": 15 },
        listPrices: { "vendor/premium": 25 },
        firstTabDiscount: { amount: 10, available: false },
      }),
      ["vendor/premium"],
    );
    expect(pricing.get("vendor/premium")).toEqual({ price: 15 });
  });

  it("a quote without listPrices renders plain prices (older server)", () => {
    const pricing = freebuffPickerPricingForInstance(quote({ prices: { "vendor/premium": 15 } }), [
      "vendor/premium",
    ]);
    expect(pricing.get("vendor/premium")).toEqual({ price: 15 });
  });

  it("projects an active off-peak window before reading prices, with the policy notice", () => {
    const pricing = freebuffPickerPricingForInstance(
      quote({
        prices: { "vendor/flash": 15 },
        offPeak: { "vendor/flash": FLASH_POLICY },
        priceChanges: [],
      }),
      ["vendor/flash"],
      // Pinned clock — CI runs UTC, so wall-clock time makes the window
      // state nondeterministic (CI caught this at 22:02 UTC, inside the
      // window). Inside 22→06: off-peak price + its notice.
      Date.parse("2026-09-18T23:00:00Z"),
    );
    expect(pricing.get("vendor/flash")).toEqual({
      price: 10,
      notice: "Off-peak pricing · 15 Freebucks/hour at peak",
    });
  });

  it("reads peak pricing outside the window at a pinned clock", () => {
    const pricing = freebuffPickerPricingForInstance(
      quote({
        prices: { "vendor/flash": 15 },
        offPeak: { "vendor/flash": FLASH_POLICY },
        priceChanges: [],
      }),
      ["vendor/flash"],
      Date.parse("2026-09-18T12:00:00Z"),
    );
    expect(pricing.get("vendor/flash")).toEqual({
      price: 15,
      notice: "Peak pricing · 10 Freebucks/hour off-peak",
    });
  });

  it("projects the raw policy price as the strike when a discount meets off-peak", () => {
    const pricing = freebuffPickerPricingForInstance(
      quote({
        prices: { "vendor/flash": 15 },
        listPrices: { "vendor/flash": 15 },
        offPeak: { "vendor/flash": FLASH_POLICY },
        priceChanges: [],
        firstTabDiscount: { amount: 10, available: true },
      }),
      ["vendor/flash"],
      Date.parse("2026-09-18T23:00:00Z"),
    );
    const row = pricing.get("vendor/flash");
    // Inside the window: policy price 10, first-tab −10 → payable 0.
    // The raw policy price (10) is the strike target above it.
    expect(row).toEqual({
      price: 0,
      listPrice: 10,
      notice: "Off-peak pricing · 15 Freebucks/hour at peak",
    });
  });

  it("prices only the rows the picker actually shows", () => {
    const pricing = freebuffPickerPricingForInstance(
      quote({ prices: { "vendor/premium": 15, "vendor/hidden": 99 } }),
      ["vendor/premium"],
    );
    expect(pricing.size).toBe(1);
    expect(pricing.has("vendor/hidden")).toBe(false);
  });
});
