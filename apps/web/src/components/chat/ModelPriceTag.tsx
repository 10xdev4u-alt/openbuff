/**
 * Freebuff picker price tag (issue #126): the right-aligned quote price with
 * the optional struck-through list price beside it. Extracted from
 * ModelListRow so the discount view stays directly testable without
 * combobox context.
 *
 * @module components/chat/ModelPriceTag
 */
import type { FreebuffPickerPrice } from "./modelPickerPricing";

export function ModelPriceTag({ pricing }: { pricing: FreebuffPickerPrice }) {
  return (
    <span className="shrink-0 text-right text-[11px] leading-none tabular-nums text-muted-foreground/70">
      {pricing.listPrice !== undefined ? (
        <span className="mr-1 line-through opacity-70">{pricing.listPrice}</span>
      ) : null}
      {pricing.price}
    </span>
  );
}
