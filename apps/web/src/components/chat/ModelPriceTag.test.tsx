/**
 * ModelPriceTag rendering (issue #126): the freebuff quote's strike-through
 * discount view. Static-markup assertions — struck list price beside the
 * effective price, plain price, or nothing.
 *
 * @module components/chat/ModelPriceTag
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ModelPriceTag } from "./ModelPriceTag";

function html(pricing: Parameters<typeof ModelPriceTag>[0]["pricing"]): string {
  return renderToStaticMarkup(<ModelPriceTag pricing={pricing} />);
}

describe("ModelPriceTag", () => {
  it("draws the list price struck through beside the effective price", () => {
    const out = html({ price: 15, listPrice: 25 });
    expect(out).toContain("line-through");
    expect(out).toContain(">25<");
    expect(out).toContain(">15<");
  });

  it("renders the price plain when there is no strike target", () => {
    const out = html({ price: 15 });
    expect(out).not.toContain("line-through");
    expect(out).toContain(">15<");
  });
});
