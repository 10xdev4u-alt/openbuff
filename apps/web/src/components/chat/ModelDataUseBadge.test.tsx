/**
 * ModelDataUseBadge rendering: the warning chip for disclosed freebuff
 * rows. Static-markup assertions — label text, full-sentence title for
 * both disclosure kinds, and nothing at all for undefined.
 *
 * @module components/chat/ModelDataUseBadge
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ModelDataUseBadge } from "./ModelDataUseBadge";
import { freebuffPickerDisclosureFor } from "./modelPickerDisclosures";

function html(slug: string | undefined): string {
  return renderToStaticMarkup(
    <ModelDataUseBadge
      disclosure={slug === undefined ? undefined : freebuffPickerDisclosureFor(slug)}
    />,
  );
}

describe("ModelDataUseBadge", () => {
  it("renders the training label with the full sentence as title", () => {
    const out = html("meta/muse-spark-1.2-contributor");
    expect(out).toContain("Trains on prompts");
    expect(out).toContain("AI training");
  });

  it("renders the retention label with the full sentence as title", () => {
    const out = html("stealth/space-bunny-alpha");
    expect(out).toContain("Retains prompts");
    expect(out).toContain("retains your prompts");
  });

  it("renders nothing for undisclosed rows", () => {
    expect(html(undefined)).toBe("");
    expect(html("z-ai/glm-5.3-flash")).toBe("");
  });
});
