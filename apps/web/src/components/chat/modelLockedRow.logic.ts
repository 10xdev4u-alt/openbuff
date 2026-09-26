/**
 * Pure locked-row gate (upstream's `freebuffPlanRequired` doctrine, ported
 * to the fork's picker/send paths).
 *
 * Upstream lists tier-locked rows instead of hiding them — the thing
 * standing between the user and the row is a plan, and hiding it gives the
 * upgrade nothing to point at. The driver mirrors that: the locked slugs
 * ride the snapshot flagged `isLegacy` so the picker draws them disabled.
 * This resolver is the second half of the same law on the SEND path: a
 * locked slug must not go out as a pick, even from a composer that never
 * re-selected it — released binaries can hold a sticky pick from before the
 * row was gated (0.0.38 listed gpt-6-luna as a fresh pick).
 *
 * The lock has two sources, in upstream's own precedence: the SERVER's
 * per-viewer `planRequiredModelIds` (present = authoritative — the decision
 * turns on the resolved access tier, which only the server knows) and the
 * static census set (`FREEBUFF_PLAN_REQUIRED_MODEL_SLUGS`, the old-client
 * fallback when the field is absent).
 *
 * Kept pure and provider-scoped: only the freebuff driver can lock a row;
 * every other driver returns null and is untouched.
 *
 * @module components/chat/modelLockedRow
 */

import { FREEBUFF_PLAN_REQUIRED_LINE, isFreebuffPlanRequiredModel } from "@t3tools/contracts";

export interface LockedModelBlock {
  /** The upstream plan-required sentence, naming the model. */
  readonly line: string;
  /** The row's display name when the picker list knows it. */
  readonly modelName: string;
}

export function resolveLockedModelBlock(input: {
  readonly driverKind: string;
  readonly model: string;
  readonly models: ReadonlyArray<{ readonly slug: string; readonly name: string }> | undefined;
  /** The SERVER's per-viewer verdict (upstream `freebucks.planRequiredModelIds`)
   *  when the session/quote has one. Present = authoritative (the decision
   *  turns on the resolved access tier — and once, the country — which only
   *  the server knows; a client deciding for itself would be reading its own
   *  belief). Absent = fall back to the static census (the old-client law). */
  readonly planRequiredModelIds?: ReadonlyArray<string> | undefined;
}): LockedModelBlock | null {
  if (input.driverKind !== "freebuff") return null;
  const serverVerdict = input.planRequiredModelIds;
  const locked =
    serverVerdict !== undefined
      ? serverVerdict.includes(input.model)
      : isFreebuffPlanRequiredModel(input.model);
  if (!locked) return null;
  const modelName =
    input.models?.find((candidate) => candidate.slug === input.model)?.name ?? input.model;
  return {
    line: `${modelName} ${FREEBUFF_PLAN_REQUIRED_LINE.toLowerCase()}`,
    modelName,
  };
}
