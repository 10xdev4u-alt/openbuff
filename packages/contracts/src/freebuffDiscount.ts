/**
 * First-tab discount math (issue #122) — a faithful port of upstream's
 * `common/src/util/freebuff-first-tab-discount.ts`, reduced to the pure price
 * surface. Upstream's session-holder (`firstTabQuoteForSession`) and marketing
 * copy variants are desktop/CLI concerns and stay unported.
 *
 * Invariants worth keeping exactly as upstream:
 * - Discounts are computed from LIST prices, so re-applying never stacks and
 *   the crossed-out original survives beside each discounted row.
 * - A quote from a server predating `listPrices` answers `undefined` for
 *   every row rather than guessing (`price + amount` is wrong for every row
 *   the zero floor clamped).
 *
 * @module freebuffDiscount
 */

/** Presence opts into the offer; the session POST also requires it at purchase time. */
export interface FreebuffFirstTabDiscount {
  amount: number;
  available: boolean;
}

/**
 * The priceable slice of the Freebucks quote (upstream `FreebuffFreebucksInfo`):
 * only the fields the discount math reads.
 */
export interface FreebucksPriceQuote {
  balance: number;
  /** Session price per model id; only metered models appear. */
  prices: Readonly<Record<string, number>>;
  planId: string | null;
  /** Regular prices, present once the wire supplies them or a discount is applied. */
  listPrices?: Readonly<Record<string, number>> | undefined;
  firstTabDiscount?: FreebuffFirstTabDiscount | undefined;
}

export const discountedSessionPrice = (price: number, discount: number): number =>
  Math.max(0, price - discount);

/**
 * Discounts from the LIST prices, so re-applying to an already-discounted
 * quote never stacks, and keeps those list prices on the quote for the
 * crossed-out original beside each discounted row.
 */
export function applyFirstTabDiscount(
  info: FreebucksPriceQuote,
  discount: FreebuffFirstTabDiscount,
): FreebucksPriceQuote {
  const listPrices = info.listPrices ?? info.prices;
  return {
    ...info,
    firstTabDiscount: discount,
    listPrices,
    prices: Object.fromEntries(
      Object.entries(listPrices).map(([model, price]) => [
        model,
        discountedSessionPrice(price, discount.available ? discount.amount : 0),
      ]),
    ),
  };
}

/**
 * The list price to draw crossed out beside `modelId`'s discounted price, or
 * undefined when there is nothing to cross out: no offer, the offer in use by
 * another session, an unpriced row, or a row the discount did not move (a row
 * already at 0 is not "0 off 0"). A quote from a server that predates
 * `listPrices` answers undefined for every row rather than guessing —
 * `price + amount` is wrong for every row the zero floor clamped.
 */
export function firstTabListPriceFor(
  info: Pick<FreebucksPriceQuote, "prices" | "listPrices" | "firstTabDiscount"> | null | undefined,
  modelId: string,
): number | undefined {
  if (!info?.firstTabDiscount?.available) return undefined;
  const price = info.prices[modelId];
  const listPrice = info.listPrices?.[modelId];
  if (price === undefined || listPrice === undefined || listPrice <= price) return undefined;
  return listPrice;
}
