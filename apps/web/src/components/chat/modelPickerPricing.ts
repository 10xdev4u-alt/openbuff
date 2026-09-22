/**
 * Freebuff picker pricing view-model (issue #126) — the web-side join that
 * turns the quote the server already serves into per-row pricing.
 *
 * Same discipline as FreebuffCockpit: the snapshot is the single data
 * source, the quote is OPAQUE server-authored data, and nothing is
 * fabricated. The wire's `prices` are the EFFECTIVE prices (the server has
 * already applied any discount the session holds — re-applying the discount
 * here would double-discount; RED caught exactly that). `firstTabListPriceFor`
 * answers the strike target — the list price beside the discounted row — and
 * answers undefined where there is nothing to show: no offer, offer in use,
 * unpriced row, or a row the discount did not move. Rows the quote doesn't
 * price are absent from the map entirely.
 *
 * @module components/chat/modelPickerPricing
 */
import {
  applyFreebucksPriceChanges,
  firstTabListPriceFor,
  type FreebuffProviderFreebucks,
} from "@t3tools/contracts";

export interface FreebuffPickerPrice {
  readonly price: number;
  /** Strike-through target; undefined means "no discount to show". */
  readonly listPrice?: number;
  /** Server-authored policy prose (e.g. off-peak window), when one applies. */
  readonly notice?: string;
}

export function freebuffPickerPricingForInstance(
  freebucks: FreebuffProviderFreebucks | null | undefined,
  modelSlugs: ReadonlyArray<string>,
): ReadonlyMap<string, FreebuffPickerPrice> {
  if (!freebucks) {
    return new Map();
  }
  // Project the server's price policy (off-peak windows, dated changes)
  // BEFORE reading prices: the wire `prices` alone go stale the moment a
  // window activates. Absent policy fields make this a structural no-op
  // (the util returns the same reference it was given).
  const projected = applyFreebucksPriceChanges(
    {
      prices: freebucks.prices,
      ...(freebucks.listPrices ? { listPrices: freebucks.listPrices } : {}),
      ...(freebucks.priceNotices ? { priceNotices: freebucks.priceNotices } : {}),
      ...(freebucks.priceChanges ? { priceChanges: freebucks.priceChanges } : {}),
      ...(freebucks.firstTabDiscount ? { firstTabDiscount: freebucks.firstTabDiscount } : {}),
      ...(freebucks.offPeak ? { offPeak: freebucks.offPeak } : {}),
    },
    Date.now(),
  );
  const out = new Map<string, FreebuffPickerPrice>();
  for (const slug of modelSlugs) {
    const price = projected.prices[slug];
    if (price === undefined) {
      continue;
    }
    const listPrice = firstTabListPriceFor(projected, slug);
    const notice = projected.priceNotices?.[slug];
    out.set(
      slug,
      listPrice !== undefined || notice !== undefined
        ? {
            price,
            ...(listPrice !== undefined ? { listPrice } : {}),
            ...(notice ? { notice } : {}),
          }
        : { price },
    );
  }
  return out;
}
