/**
 * Data-use disclosure view-model (picker disclosures): the join from
 * contracts' disclosure sets to per-row warnings. Training beats retention
 * if a row ever carries both; undisclosed and unknown slugs answer
 * undefined so their rows render untouched.
 *
 * @module components/chat/modelPickerDisclosures
 */
import { describe, expect, it } from "vite-plus/test";

import { freebuffPickerDisclosureFor } from "./modelPickerDisclosures";

describe("freebuffPickerDisclosureFor", () => {
  it("discloses the training-data row", () => {
    const d = freebuffPickerDisclosureFor("meta/muse-spark-1.2-contributor");
    expect(d?.kind).toBe("training");
    expect(d?.label).toMatch(/trains/i);
    expect(d?.title).toMatch(/training/i);
  });

  it("discloses the prompt-retention stealth row", () => {
    const d = freebuffPickerDisclosureFor("stealth/space-bunny-alpha");
    expect(d?.kind).toBe("retention");
    expect(d?.label).toMatch(/retains/i);
    expect(d?.title).toMatch(/retains/i);
    // Retention is NOT training — the two disclosures must not blur.
    expect(d?.title).not.toMatch(/training/i);
  });

  it("leaves undisclosed and unknown rows alone", () => {
    for (const slug of [
      "z-ai/glm-5.3-flash",
      "mimo/mimo-v2.5",
      "upstage/solar-pro4",
      "stealth/ox-alpha",
      "acme/nonexistent",
    ]) {
      expect(freebuffPickerDisclosureFor(slug), slug).toBeUndefined();
    }
  });

  it("keeps the disclosure sets in sync with the servable roster", async () => {
    // A disclosure for a slug outside the pairing map would render a badge
    // on a row the tier cannot serve; a servable row added upstream with a
    // disclosure we lack is caught by the weekly watch map instead.
    const { FREEBUFF_FREE_AGENT_BY_MODEL } = await import("@t3tools/contracts");
    const {
      FREEBUFF_TRAINING_DATA_MODEL_SLUGS,
      FREEBUFF_PROMPT_RETENTION_MODEL_SLUGS,
    } = await import("@t3tools/contracts");
    for (const slug of [
      ...FREEBUFF_TRAINING_DATA_MODEL_SLUGS,
      ...FREEBUFF_PROMPT_RETENTION_MODEL_SLUGS,
    ]) {
      expect(slug in FREEBUFF_FREE_AGENT_BY_MODEL, `${slug} must be servable`).toBe(true);
    }
  });
});
