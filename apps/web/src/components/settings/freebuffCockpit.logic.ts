import type {
  FreebuffProviderFreeWindows,
  FreebuffProviderFreebucks,
  FreebuffProviderQuotaRow,
  FreebuffProviderUsage,
} from "@t3tools/contracts";

/**
 * Pure cockpit logic for the Freebuff free-tier usage panel (issue #31).
 *
 * Upstream rules honored here:
 * - `pool` is an OPAQUE token — rows are GROUPED by it, never matched on its
 *   value; `poolLabel` is the server-authored display string.
 * - Rows without a pool (older servers) become their own per-model group
 *   instead of collapsing into a fake shared pool.
 * - `freebucks: null` means "meter exists, refresh failed": the UI clears the
 *   stale balance. Absent means no meter was supplied at all.
 */

export interface CockpitPoolGroup {
  readonly pool: string;
  readonly label: string;
  readonly rows: ReadonlyArray<
    FreebuffProviderQuotaRow & { readonly model: string }
  >;
}

export interface CockpitUsageViewModel {
  readonly poolGroups: ReadonlyArray<CockpitPoolGroup>;
  /** Null freebucks: meter block exists but failed to refresh this cycle. */
  readonly freebucksUnavailable: boolean;
  /** Narrowed: null is collapsed into `freebucksUnavailable`. */
  readonly freebucks: FreebuffProviderFreebucks | undefined;
  readonly freeWindows: FreebuffProviderFreeWindows | undefined;
  /** True when the whole block is absent (older server) — render a hint. */
  readonly noMeter: boolean;
  readonly quotaExempt: boolean;
}

export function groupQuotaRowsByPool(
  rateLimitsByModel: Record<string, FreebuffProviderQuotaRow> | undefined,
): ReadonlyArray<CockpitPoolGroup> {
  if (rateLimitsByModel === undefined) {
    return [];
  }
  const groups = new Map<string, CockpitPoolGroup>();
  for (const [model, row] of Object.entries(rateLimitsByModel)) {
    const key = row.pool ?? `model:${model}`;
    const entry: CockpitPoolGroup["rows"][number] = { ...row, model };
    const existing = groups.get(key);
    if (existing !== undefined) {
      groups.set(key, { ...existing, rows: [...existing.rows, entry] });
      continue;
    }
    groups.set(key, {
      pool: key,
      label: row.poolLabel ?? (row.pool === undefined ? model : key),
      rows: [entry],
    });
  }
  return [...groups.values()];
}

export function buildCockpitViewModel(usage: FreebuffProviderUsage | undefined): CockpitUsageViewModel {
  if (usage === undefined) {
    return {
      poolGroups: [],
      freebucksUnavailable: false,
      freebucks: undefined,
      freeWindows: undefined,
      noMeter: true,
      quotaExempt: false,
    };
  }
  return {
    poolGroups: groupQuotaRowsByPool(usage.rateLimitsByModel),
    freebucksUnavailable: usage.freebucks === null,
    freebucks: usage.freebucks === null ? undefined : usage.freebucks,
    freeWindows: usage.freeWindows,
    noMeter: false,
    quotaExempt: usage.freebucks?.quotaExempt === true,
  };
}

/** Fraction used, clamped to [0, 1]; no limit → 0 (never render fake progress). */
export function usageFraction(used: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, used / limit));
}

/**
 * Minute-granularity countdown (upstream perf rule: no repaint loops).
 * Rendered from the reader's clock against the server's absolute `resetAt` —
 * never a recomputed pool boundary.
 */
export function formatResetCountdown(
  resetAt: string,
  nowMs: number,
): string {
  const target = Date.parse(resetAt);
  if (Number.isNaN(target)) {
    return "reset time unknown";
  }
  const diffMs = target - nowMs;
  if (diffMs <= 0) {
    return "resetting…";
  }
  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) {
    return `resets in ${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) {
    return remainder === 0 ? `resets in ${hours}h` : `resets in ${hours}h ${remainder}m`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `resets in ${days}d` : `resets in ${days}d ${restHours}h`;
}

/** Freebucks balance formatting — two decimals max, no phantom precision. */
export function formatFreebucksBalance(balance: number): string {
  return Number.isInteger(balance) ? String(balance) : balance.toFixed(2).replace(/\.?0+$/, "");
}
