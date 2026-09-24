/**
 * Pure data-use consent gate (PR #139 review fix; generalized in the
 * disclosures arc).
 *
 * Two free rows carry supplier data-use terms a user must accept before
 * their first prompt goes through:
 *
 *  - TRAINING (`FREEBUFF_TRAINING_DATA_MODEL_SLUGS`): the Muse Spark
 *    Contributor row's whole discount is Meta training on the prompts and
 *    completions sent through it — upstream marks the row
 *    `dataUse: 'training'`. The adapter's `data_collection: "deny"`
 *    governs OUR trace retention, not the supplier's grant, and is not a
 *    substitute for disclosure.
 *  - RETENTION (`FREEBUFF_PROMPT_RETENTION_MODEL_SLUGS`): Space Bunny
 *    Alpha's anonymous stealth host retains prompts under its own terms
 *    without training on them — a different sentence a user needs to tell
 *    apart from training before pasting a private repo.
 *
 * The gate keys on the wire slug (the sets live in contracts, next to the
 * pairing table they mirror). Kept pure so the gate is testable without
 * React or dialogs.
 *
 * @module components/chat/modelDataUseConsent
 */

import {
  FREEBUFF_PROMPT_RETENTION_MODEL_SLUGS,
  FREEBUFF_TRAINING_DATA_MODEL_SLUGS,
} from "@t3tools/contracts";

export type DataUseConsentDecision =
  | { readonly action: "proceed" }
  | { readonly action: "confirm"; readonly message: string }
  | { readonly action: "cancel"; readonly message: string };

export function resolveDataUseConsent(input: {
  readonly nextModel: string;
  readonly models: ReadonlyArray<{ readonly slug: string; readonly name: string }> | undefined;
}): DataUseConsentDecision {
  if (FREEBUFF_TRAINING_DATA_MODEL_SLUGS.has(input.nextModel)) {
    return decide(input, {
      claim: "trains on your prompts and completions",
      tradeoff: "that is what makes it free",
      unavailable: "This model trains on your prompts and completions. Consent flow unavailable — try again.",
    });
  }
  if (FREEBUFF_PROMPT_RETENTION_MODEL_SLUGS.has(input.nextModel)) {
    return decide(input, {
      claim: "retains your prompts under its own terms (it does not train on them)",
      tradeoff: "know that before pasting anything private",
      unavailable:
        "This model's supplier retains your prompts. Consent flow unavailable — try again.",
    });
  }
  return { action: "proceed" };
}

function decide(
  input: {
    readonly nextModel: string;
    readonly models: ReadonlyArray<{ readonly slug: string; readonly name: string }> | undefined;
  },
  copy: { readonly claim: string; readonly tradeoff: string; readonly unavailable: string },
): DataUseConsentDecision {
  const row = input.models?.find((candidate) => candidate.slug === input.nextModel);
  if (row === undefined) {
    // The gate fires on the wire slug, so the row should exist — but a
    // picker that lost it must not be silently waved through.
    return { action: "cancel", message: copy.unavailable };
  }
  const message = `${row.name} ${copy.claim} — ${copy.tradeoff}. Continue and send content under those terms?`;
  return { action: "confirm", message };
}
