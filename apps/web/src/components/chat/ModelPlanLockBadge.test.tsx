/**
 * ModelPlanLockBadge rendering: the "Paid plan" chip for tier-locked
 * freebuff rows. Static-markup assertions — label text, full-sentence
 * title, and nothing at all for unlocked rows.
 *
 * @module components/chat/ModelPlanLockBadge
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ModelPlanLockBadge } from "./ModelPlanLockBadge";

function html(planRequired: boolean | undefined, line?: string): string {
  return renderToStaticMarkup(<ModelPlanLockBadge planRequired={planRequired} line={line} />);
}

describe("ModelPlanLockBadge", () => {
  it("renders the Paid plan label with the sentence as title", () => {
    const out = html(true, "GPT-6 Luna included with a paid plan.");
    expect(out).toContain("Paid plan");
    expect(out).toContain("included with a paid plan");
  });

  it("renders nothing for unlocked rows", () => {
    expect(html(false)).toBe("");
    expect(html(undefined)).toBe("");
  });
});
