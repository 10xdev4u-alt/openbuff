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
}): LockedModelBlock | null {
  if (input.driverKind !== "freebuff") return null;
  if (!isFreebuffPlanRequiredModel(input.model)) return null;
  const modelName =
    input.models?.find((candidate) => candidate.slug === input.model)?.name ?? input.model;
  return {
    line: `${modelName} ${FREEBUFF_PLAN_REQUIRED_LINE.toLowerCase()}`,
    modelName,
  };
}
