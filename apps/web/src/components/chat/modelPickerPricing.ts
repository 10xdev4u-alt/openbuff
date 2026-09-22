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
import { firstTabListPriceFor, type FreebuffProviderFreebucks } from "@t3tools/contracts";

export interface FreebuffPickerPrice {
  readonly price: number;
  /** Strike-through target; undefined means "no discount to show". */
  readonly listPrice?: number;
}

export function freebuffPickerPricingForInstance(
  freebucks: FreebuffProviderFreebucks | null | undefined,
  modelSlugs: ReadonlyArray<string>,
): ReadonlyMap<string, FreebuffPickerPrice> {
  if (!freebucks) {
    return new Map();
  }
  const out = new Map<string, FreebuffPickerPrice>();
  for (const slug of modelSlugs) {
    const price = freebucks.prices[slug];
    if (price === undefined) {
      continue;
    }
    const listPrice = firstTabListPriceFor(freebucks, slug);
    out.set(slug, listPrice !== undefined ? { price, listPrice } : { price });
  }
  return out;
}
