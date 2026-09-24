/**
 * Freebuff picker data-use disclosure view-model — the web-side join that
 * turns contracts' disclosure sets into per-row warnings.
 *
 * Upstream's catalog carries two disclosure kinds our picker must render
 * before a user pastes code: rows whose supplier TRAINS on prompts
 * (`FREEBUFF_TRAINING_DATA_MODEL_SLUGS` — first use is already gated
 * upstream-style by our consent flow in ChatView) and rows whose supplier
 * RETAINS prompts without training (`FREEBUFF_PROMPT_RETENTION_MODEL_SLUGS`
 * — Space Bunny Alpha's anonymous stealth host, which upstream's own row
 * warns about: "Anonymous provider retains prompts"). The discounts and the
 * 1M-context convenience are real; so is the disclosure. Slugs outside the
 * free tier answer undefined.
 *
 * @module components/chat/modelPickerDisclosures
 */
import {
  FREEBUFF_PROMPT_RETENTION_MODEL_SLUGS,
  FREEBUFF_TRAINING_DATA_MODEL_SLUGS,
} from "@t3tools/contracts";

export interface FreebuffPickerDisclosure {
  readonly kind: "training" | "retention";
  readonly label: string;
  /** Full sentence carried as the badge's title/aria-label. */
  readonly title: string;
}

const TRAINING_DISCLOSURE: FreebuffPickerDisclosure = {
  kind: "training",
  label: "Trains on prompts",
  title: "The supplier of this model may use your prompts and completions for AI training.",
};

const RETENTION_DISCLOSURE: FreebuffPickerDisclosure = {
  kind: "retention",
  label: "Retains prompts",
  title:
    "The supplier of this model retains your prompts under its own terms (it does not train on them).",
};

export function freebuffPickerDisclosureFor(
  slug: string,
): FreebuffPickerDisclosure | undefined {
  if (FREEBUFF_TRAINING_DATA_MODEL_SLUGS.has(slug)) {
    return TRAINING_DISCLOSURE;
  }
  if (FREEBUFF_PROMPT_RETENTION_MODEL_SLUGS.has(slug)) {
    return RETENTION_DISCLOSURE;
  }
  return undefined;
}
