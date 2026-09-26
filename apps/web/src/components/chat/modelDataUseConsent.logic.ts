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

import {
  readConsentedDataUseModelSlugs,
} from "./modelDataUseConsent.storage";

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

/**
 * The send-path variant (the #157 gap): the switch-time gate fires only when
 * the user CHANGES models mid-thread, so a fresh thread whose composer was
 * pointed at a disclosed row before its first send — or any thread re-opened
 * on one — never met a consent dialog. This resolver is consulted on every
 * send and keys on the per-model consent journal instead of a one-shot
 * thread-local flag:
 *
 *  - Undisclosed rows proceed untouched (the overwhelming majority of sends
 *    must not gain a lookup or a dialog).
 *  - A disclosed row with no recorded consent asks, with the SAME
 *    training-distinct copy as the switch gate. The resolver is READ-ONLY:
 *    the caller records the consent (see
 *    `rememberConsentedDataUseModelSlug`) only after the user explicitly
 *    accepts, so a decline — or a dialog that never rendered — leaves the
 *    journal untouched and the next send re-asks. The ask cannot be waited
 *    out, and a forgotten record fails toward asking, never toward silence.
 *  - A recorded consent (this thread, another thread, a previous session)
 *    proceeds — including when the picker has since lost the row, since the
 *    consent predates the loss.
 *
 * Kept pure over the injected storage helpers so the gate stays testable
 * without React, dialogs, or a live storage.
 */
export function resolveDataUseConsentForSend(input: {
  readonly model: string;
  readonly models: ReadonlyArray<{ readonly slug: string; readonly name: string }> | undefined;
  readonly consents?: () => ReadonlyArray<string>;
}): DataUseConsentDecision {
  const disclosed =
    FREEBUFF_TRAINING_DATA_MODEL_SLUGS.has(input.model) ||
    FREEBUFF_PROMPT_RETENTION_MODEL_SLUGS.has(input.model);
  if (!disclosed) return { action: "proceed" };
  const readConsents = input.consents ?? readConsentedDataUseModelSlugs;
  if (readConsents().includes(input.model)) return { action: "proceed" };
  return resolveDataUseConsent({
    nextModel: input.model,
    models: input.models,
  });
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
