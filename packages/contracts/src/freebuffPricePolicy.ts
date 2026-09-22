// @effect-diagnostics globalDate:off
/**
 * Freebuff price-policy projection (issue #129) — a faithful port of
 * upstream's `common/src/util/freebuff-price-changes.ts` +
 * `freebuff-off-peak-price.ts`, reduced to the pure surface. The CLI-only
 * wakeup watcher (`watchFreebucksPriceChanges`) stays unported: web
 * re-renders from snapshots instead of owning a persistent-process timer.
 *
 * Wire discipline (upstream type docs, binding):
 * - The server owns the policy; clients PROJECT it into `prices` — including
 *   first-tab discounts — "even when refreshes fail".
 * - A fresh response replaces the policy; ADMITTED CHARGES NEVER CHANGE.
 * - Dated changes and recurring windows apply to NEW-session quotes only.
 * - Nothing is invented for unpriced models; absent policy is a no-op.
 * - Port deviation: `now` is a REQUIRED parameter (upstream defaults to
 *   `Date.now()`). The caller owns the clock; these functions stay pure.
 *
 * @module freebuffPricePolicy
 */
import { discountedSessionPrice, type FreebuffFirstTabDiscount } from "./freebuffDiscount.ts";

/** Server-owned recurring price window; UTC hours, daily [start, end). */
export interface FreebuffOffPeakPrice {
  startHourUtc: number;
  endHourUtc: number;
  price: number;
  regularPrice: number;
}

/** Scheduled change announced by the server; never reprices admitted sessions. */
export interface FreebuffPriceChange {
  at: string;
  modelId: string;
  price: number;
  tagline: string;
}

/** The policy-bearing slice of the Freebucks quote. */
export interface PricePolicyQuote {
  prices: Readonly<Record<string, number>>;
  listPrices?: Readonly<Record<string, number>> | undefined;
  priceNotices?: Readonly<Record<string, string>> | undefined;
  priceChanges?: readonly FreebuffPriceChange[] | undefined;
  firstTabDiscount?: FreebuffFirstTabDiscount | undefined;
  offPeak?: Readonly<Record<string, FreebuffOffPeakPrice>> | undefined;
}

/** Resolve a server-owned daily policy, including windows crossing midnight. */
export function offPeakPriceAt(offer: FreebuffOffPeakPrice, now: number) {
  const start = new Date(now);
  start.setUTCHours(offer.startHourUtc, 0, 0, 0);
  if (+start > now) start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(start);
  end.setUTCHours(offer.endHourUtc, 0, 0, 0);
  if (+end <= +start) end.setUTCDate(end.getUTCDate() + 1);
  const active = now < +end;
  if (!active) {
    start.setUTCDate(start.getUTCDate() + 1);
    end.setUTCDate(end.getUTCDate() + 1);
  }
  return {
    start,
    end,
    nextChangeAt: active ? +end : +start,
    price: active ? offer.price : offer.regularPrice,
    tagline: active
      ? `Off-peak pricing · ${offer.regularPrice} Freebucks/hour at peak`
      : `Peak pricing · ${offer.price} Freebucks/hour off-peak`,
  };
}

/**
 * Apply the SERVER'S dated changes and recurring policies to new-session
 * quotes only. Never changes balances or an already-admitted session's
 * charge. Returns the SAME reference when nothing is due and nothing moved
 * (boundary coherence), and never mutates the input.
 */
export function applyFreebucksPriceChanges<T extends PricePolicyQuote>(info: T, now: number): T {
  const due = info.priceChanges?.filter((change) => Date.parse(change.at) <= now);
  let prices = info.prices;
  let listPrices = info.listPrices;
  let priceNotices = info.priceNotices;
  const apply = (modelId: string, price: number, tagline: string) => {
    // Never add an unpriced model or invent metadata on older responses.
    if (prices[modelId] === undefined) return;
    const discounted = discountedSessionPrice(
      price,
      info.firstTabDiscount?.available ? info.firstTabDiscount.amount : 0,
    );
    if (prices[modelId] !== discounted) prices = { ...prices, [modelId]: discounted };
    if (listPrices && listPrices[modelId] !== price)
      listPrices = { ...listPrices, [modelId]: price };
    if (priceNotices?.[modelId] !== tagline) priceNotices = { ...priceNotices, [modelId]: tagline };
  };
  for (const change of (due ?? []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    apply(change.modelId, change.price, change.tagline);
  }
  // Recurring policy remains authoritative after dated transitions expire.
  for (const [modelId, offer] of Object.entries(info.offPeak ?? {})) {
    const current = offPeakPriceAt(offer, now);
    apply(modelId, current.price, current.tagline);
  }
  if (
    !due?.length &&
    prices === info.prices &&
    listPrices === info.listPrices &&
    priceNotices === info.priceNotices
  ) {
    return info;
  }
  // The generic spread only replaces the policy fields; the cast preserves
  // the caller's quote type (upstream's pattern — proven by the suite).
  return {
    ...info,
    prices,
    ...(listPrices ? { listPrices } : {}),
    priceNotices,
    priceChanges: info.priceChanges?.filter((change) => Date.parse(change.at) > now),
  } as T;
}

/** Earliest instant at which the projected prices could change again. */
export function nextFreebucksPriceChange(
  info: Pick<PricePolicyQuote, "priceChanges" | "offPeak"> | null | undefined,
  now: number,
): number {
  return Math.min(
    ...(info?.priceChanges ?? []).map((change) => Date.parse(change.at)).filter(Number.isFinite),
    ...Object.values(info?.offPeak ?? {}).map((offer) => offPeakPriceAt(offer, now).nextChangeAt),
  );
}
