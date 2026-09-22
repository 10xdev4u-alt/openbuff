import { describe, expect, it } from "vite-plus/test";

import {
  applyFirstTabDiscount,
  discountedSessionPrice,
  firstTabListPriceFor,
  type FreebuffFirstTabDiscount,
  type FreebucksPriceQuote,
} from "./freebuffDiscount.ts";

/** Upstream `freebucksFixture` reduced to the fields the discount math reads. */
function quoteFixture(balance: number, prices: Record<string, number>): FreebucksPriceQuote {
  return { balance, prices, planId: null };
}

describe("discountedSessionPrice", () => {
  it("subtracts and clamps at zero", () => {
    expect(discountedSessionPrice(25, 10)).toBe(15);
    expect(discountedSessionPrice(5, 10)).toBe(0);
    expect(discountedSessionPrice(0, 10)).toBe(0);
  });
});

describe("applyFirstTabDiscount", () => {
  it("discounts each model with a zero floor without changing balances or the source quote", () => {
    const original = quoteFixture(7, { cheap: 5, exact: 10, premium: 25, promo: 0 });
    const offer: FreebuffFirstTabDiscount = { amount: 10, available: true };
    const quote = applyFirstTabDiscount(original, offer);
    expect(quote.prices).toEqual({ cheap: 0, exact: 0, premium: 15, promo: 0 });
    expect(quote.balance).toBe(7);
    expect(original.prices.premium).toBe(25);
    // Unavailable offer leaves prices untouched.
    expect(applyFirstTabDiscount(original, { amount: 10, available: false }).prices).toEqual(
      original.prices,
    );
  });

  it("carries the list prices for the crossed-out original and never stacks on re-application", () => {
    const original = quoteFixture(7, { cheap: 5, premium: 25, promo: 0 });
    const quote = applyFirstTabDiscount(original, { amount: 10, available: true });
    expect(quote.listPrices).toEqual(original.prices);
    // Re-applying discounts from the LIST price, not the discounted one.
    expect(applyFirstTabDiscount(quote, { amount: 10, available: true }).prices).toEqual(
      quote.prices,
    );
    // Withdrawing (in use elsewhere) restores the list prices as the quote.
    const inUse = applyFirstTabDiscount(quote, { amount: 10, available: false });
    expect(inUse.prices).toEqual(original.prices);
    expect(inUse.listPrices).toEqual(original.prices);
  });

  it("honors pre-existing listPrices as the discount base (wire-supplied, not derived)", () => {
    const original: FreebucksPriceQuote = {
      balance: 7,
      prices: { premium: 25 },
      planId: null,
      listPrices: { premium: 30 },
    };
    const quote = applyFirstTabDiscount(original, { amount: 10, available: true });
    expect(quote.listPrices).toEqual({ premium: 30 });
    expect(quote.prices).toEqual({ premium: 20 });
  });
});

describe("firstTabListPriceFor", () => {
  it("shows the crossed-out price only where an available discount moved the price", () => {
    const original = quoteFixture(7, { cheap: 5, premium: 25, promo: 0 });
    const quote = applyFirstTabDiscount(original, { amount: 10, available: true });
    expect(firstTabListPriceFor(quote, "premium")).toBe(25);
    expect(firstTabListPriceFor(quote, "cheap")).toBe(5);
    // Already free: "0 off 0" is not a discount.
    expect(firstTabListPriceFor(quote, "promo")).toBeUndefined();
    expect(firstTabListPriceFor(quote, "unpriced")).toBeUndefined();
    // In use by another session: the full price is the price, nothing struck.
    expect(
      firstTabListPriceFor(
        applyFirstTabDiscount(quote, { amount: 10, available: false }),
        "premium",
      ),
    ).toBeUndefined();
  });

  it("answers undefined for no offer, null, and an older server's quote without list prices", () => {
    const original = quoteFixture(7, { premium: 25 });
    // No offer at all on the quote.
    expect(firstTabListPriceFor(original, "premium")).toBeUndefined();
    expect(firstTabListPriceFor(null, "premium")).toBeUndefined();
    // Older server: `price + amount` would be wrong for every clamped row —
    // undefined rather than a guess.
    expect(
      firstTabListPriceFor(
        { prices: { premium: 15 }, firstTabDiscount: { amount: 10, available: true } },
        "premium",
      ),
    ).toBeUndefined();
  });
});
