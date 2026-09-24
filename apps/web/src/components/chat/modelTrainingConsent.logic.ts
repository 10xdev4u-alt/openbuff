/**
 * Pure training-data consent gate (PR #139 review fix).
 *
 * The Muse Spark Contributor row's whole discount is Meta training on the
 * prompts and completions sent through it — upstream marks the row
 * `dataUse: 'training'` and prints `FREEBUFF_AI_TRAINING_NOTICE` on it. A
 * picker that offers the row must gate first use behind an explicit
 * consent; the adapter's `data_collection: "deny"` governs OUR trace
 * retention, not the supplier's grant, and is not a substitute for
 * disclosure.
 *
 * The gate keys on the wire slug (the set lives in contracts, next to the
 * pairing table it mirrors). Kept pure so the gate is testable without
 * React or dialogs.
 *
 * @module components/chat/modelTrainingConsent
 */

import { FREEBUFF_TRAINING_DATA_MODEL_SLUGS } from "@t3tools/contracts";

export type TrainingConsentDecision =
  | { readonly action: "proceed" }
  | { readonly action: "confirm"; readonly message: string }
  | { readonly action: "cancel"; readonly message: string };

export function resolveTrainingDataConsent(input: {
  readonly nextModel: string;
  readonly models: ReadonlyArray<{ readonly slug: string; readonly name: string }> | undefined;
}): TrainingConsentDecision {
  if (!FREEBUFF_TRAINING_DATA_MODEL_SLUGS.has(input.nextModel)) {
    return { action: "proceed" };
  }
  const row = input.models?.find((candidate) => candidate.slug === input.nextModel);
  if (row === undefined) {
    // The gate fires on the wire slug, so the row should exist — but a
    // picker that lost it must not be silently waved through.
    return {
      action: "cancel",
      message:
        "This model trains on your prompts and completions. Consent flow unavailable — try again.",
    };
  }
  const message =
    `${row.name} trains on your prompts and completions — that is what makes it free. ` +
    `Continue and send content under those terms?`;
  return { action: "confirm", message };
}
