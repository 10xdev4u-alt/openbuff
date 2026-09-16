import type { FreebuffProviderUsage } from "@t3tools/contracts";
import type { FreebuffSessionResponse } from "./Services/FreebuffSession.ts";

export type { FreebuffProviderUsage };

/**
 * Usage capture for the provider snapshot (issue #31).
 *
 * Quota rows, free windows and the Freebucks meter are ACCOUNT-scoped — the
 * freshest response wins wholesale, and there is nothing to merge per model.
 * `freebucks: null` is meaningful on the wire (block exists, refresh failed):
 * it must REPLACE a stale balance, not fall back to it.
 */
export function mergeProviderUsage(
  previous: FreebuffProviderUsage | undefined,
  latest: FreebuffProviderUsage | undefined,
): FreebuffProviderUsage | undefined {
  return latest ?? previous;
}

/**
 * Project a session response onto the snapshot's usage block: only the meter
 * fields the body actually carried are captured, so an older-server body (no
 * meter fields at all) produces no capture and the snapshot keeps its previous
 * one. A lone `freebucks: null` IS a capture — it clears the stale balance.
 */
export function usageFromSessionResponse(
  response: FreebuffSessionResponse,
): FreebuffProviderUsage | undefined {
  const { rateLimitsByModel, freeWindows, freebucks } = response;
  if (rateLimitsByModel === undefined && freeWindows === undefined && freebucks === undefined) {
    return undefined;
  }
  return {
    ...(rateLimitsByModel !== undefined ? { rateLimitsByModel } : {}),
    ...(freeWindows !== undefined ? { freeWindows } : {}),
    ...(freebucks !== undefined ? { freebucks } : {}),
  };
}
