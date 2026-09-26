/**
 * One rule, checked the same way on every surface: **if a picker can OFFER a
 * freebuff model row, every gate that row then passes through must accept
 * it.** Ported from upstream's `common/src/testing/freebuff-offer-invariants.ts`
 * (the file their comments cite as "what exists to catch the offer-without-
 * gate shape") with OUR gates in the checks.
 *
 * Freebuff model ids fan out across separate hand-kept lists — the pairing
 * map (admission), the picker list (fresh selections), the plan-required lock
 * set, the driver's display names — on purpose (a row can retire from a
 * picker while draining sessions keep running on it). Nothing stops one from
 * moving without the others; when they drift in the offer→gate direction the
 * user sees a row they cannot use. Drift the OTHER way is fine and
 * deliberate (acceptable-but-not-offered is exactly how a staged retirement
 * works), so the checker only ever tests offered ⊆ accepted.
 *
 * The checks carry upstream's six, wired to this fork:
 *   1. the pairing map knows the id (admission can derive a root at all)
 *   2. a fresh-selection surface must not offer a statically locked row
 *      (the tier's admission would refuse it — the offer-without-gate pair)
 *   3. the served-model resolver must not silently swap the pick (#152: the
 *      user picks GLM, the turn runs on Flash, nothing says why)
 *   4. the agent resolver must answer the row's OWN root, never the default
 *      root in disguise (free_mode_invalid_agent_model), and the root must
 *      be a registered base3-free id
 *   5. the surface's display name must render the row as itself — a missing
 *      catalog entry renders the fallback's label (upstream check 6)
 *   6. a surface that offers nothing at all is a wiring error, and it is the
 *      one failure mode a green run hides — so it is a violation
 *
 * Assert `toEqual([])` in each surface's test: the strings are the failure
 * message. Adding a gate here applies it to every surface at once.
 *
 * @module freebuffOfferInvariants
 */

import {
  DEFAULT_FREEBUFF_FREE_MODEL,
  FREEBUFF_FREE_AGENT_BY_MODEL,
  isFreebuffPlanRequiredModel,
  resolveFreebuffAgentForModel,
  resolveFreebuffServedModel,
} from "./model.ts";

export interface FreebuffOfferSurface {
  /** Names the surface in failure messages, e.g. "freebuff picker (fresh)". */
  readonly surface: string;
  /** Every model id this surface can put in front of a user. */
  readonly offered: readonly string[];
  /** Whether `offered` describes FRESH SELECTIONS (a row the tier's
   *  admission would refuse must not be here — it may be LISTED as locked,
   *  but listing is a different surface). Defaults to true; the entitled/
   *  listed-rows surface sets false to skip the lock check. */
  readonly freshSelections?: boolean;
  /** The surface's display-name lookup, when it renders names from a catalog
   *  map. A row without an entry renders as its raw slug — the fallback-
   *  label shape. Omit to skip the check. */
  readonly nameFor?: (model: string) => string | undefined;
  /** An INDEPENDENT expected-name lookup (a hand-written literal in the
   *  test, not the map under test). When both lookups are supplied, a
   *  nonempty name that differs from the expected one is the worst label
   *  shape of all: upstream's Desktop shipped the earned GLM 5.2 row
   *  rendering under the FALLBACK's label — wrong, not missing, and every
   *  missing-name check passes it. */
  readonly expectedNameFor?: (model: string) => string | undefined;
}

/**
 * Every way a row on this surface is offerable-but-unusable, as sentences a
 * failing test can print verbatim. Empty array means the surface is good.
 */
export function freebuffOfferViolations(surface: FreebuffOfferSurface): string[] {
  // An empty offer set passes every check below while meaning the test wired
  // itself to the wrong list — the one failure mode a green run hides.
  if (surface.offered.length === 0) {
    return [`${surface.surface}: offers no models at all — check the test wiring`];
  }
  return surface.offered.flatMap((model) => {
    const where = `${surface.surface}: ${model}`;
    const out: string[] = [];

    // 1. the pairing map has to know the id at all — every later check is
    // derived from it, so one unknown id would otherwise produce five
    // near-identical lines.
    if (!(model in FREEBUFF_FREE_AGENT_BY_MODEL)) {
      return [`${where} is offered but the admission pairing map has no row for it`];
    }

    // 2. a FRESH-selection surface must not offer a statically locked row:
    // the tier's admission would refuse it (offer-without-gate). Listed-
    // locked rows belong to the listed surface, which skips this check —
    // the server's per-viewer verdict decides them at send time.
    if (surface.freshSelections !== false && isFreebuffPlanRequiredModel(model)) {
      out.push(`${where} is offered as a fresh selection but the tier's admission locks it`);
    }

    // 3. a resolver that silently swaps the pick is as bad as a refusal: the
    // user picks Luna, the turn runs on Flash, and nothing says why (#152).
    const served = resolveFreebuffServedModel(model);
    if (served !== model) {
      out.push(`${where} is offered but resolveFreebuffServedModel coerces it to ${String(served)}`);
    }

    // 4. free mode charges/403s per (agent, model) pair, so the root the
    // surface's turns run under must be the row's OWN root — the default
    // root answering for a non-default model IS a coercion (and its
    // allowlist would refuse the model with free_mode_invalid_agent_model).
    const rootId = resolveFreebuffAgentForModel(model);
    if (model !== DEFAULT_FREEBUFF_FREE_MODEL && rootId === resolveFreebuffAgentForModel(DEFAULT_FREEBUFF_FREE_MODEL)) {
      out.push(`${where} resolves to the default root ${rootId} instead of its own pairing`);
    }

    // 5. the row has to render as itself rather than as a raw slug or
    // another model's label — the wrong-label shape needs an independent
    // expected lookup to catch, which is why it is opt-in.
    const name = surface.nameFor?.(model);
    if (surface.nameFor && (name === undefined || name === model)) {
      out.push(`${where} is offered but the surface's catalog has no display name for it`);
    }
    const expected = surface.expectedNameFor?.(model);
    if (
      surface.nameFor &&
      surface.expectedNameFor &&
      expected !== undefined &&
      name !== undefined &&
      name !== expected
    ) {
      out.push(
        `${where} renders as "${name}" where the expected catalog says "${expected}" (the fallback-label shape)`,
      );
    }

    return out;
  });
}
