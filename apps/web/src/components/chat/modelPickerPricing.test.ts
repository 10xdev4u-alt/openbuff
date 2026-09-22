import { describe, expect, it } from "vite-plus/test";

import type { FreebuffProviderFreebucks } from "@t3tools/contracts";

import { freebuffPickerPricingForInstance } from "./modelPickerPricing.ts";

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

  it("prices only the rows the picker actually shows", () => {
    const pricing = freebuffPickerPricingForInstance(
      quote({ prices: { "vendor/premium": 15, "vendor/hidden": 99 } }),
      ["vendor/premium"],
    );
    expect(pricing.size).toBe(1);
    expect(pricing.has("vendor/hidden")).toBe(false);
  });
});
