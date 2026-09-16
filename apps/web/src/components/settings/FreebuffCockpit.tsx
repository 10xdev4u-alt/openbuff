import type { ServerProvider } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import {
  buildCockpitViewModel,
  formatFreebucksBalance,
  formatResetCountdown,
  usageFraction,
} from "./freebuffCockpit.logic.ts";

/**
 * Freebuff free-tier quota cockpit (issue #31, PR 3b).
 *
 * Renders the usage meter the server already serves: per-pool bars grouped by
 * the OPAQUE pool token (server-authored labels), free-window counters, and
 * the Freebucks daily + wallet balances. Countdowns render from the reader's
 * clock against absolute `resetAt` instants at MINUTE granularity (upstream
 * perf rule: no repaint loops). Handles absent meters (older servers) and the
 * null-freebucks refresh failure without crashing.
 */
export function FreebuffCockpit({ providers }: { providers: ReadonlyArray<ServerProvider> }) {
  const usage = useMemo(
    () => providers.find((provider) => provider.driver === "freebuff")?.usage,
    [providers],
  );
  const vm = useMemo(() => buildCockpitViewModel(usage), [usage]);

  // Minute-granularity tick: one rerender per minute while mounted, driven by
  // a timestamp so countdowns re-resolve against the reader's clock.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (vm.noMeter) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      {vm.poolGroups.map((group) => {
        const row = group.rows[0];
        if (row === undefined) {
          return null;
        }
        const fraction = usageFraction(row.recentCount, row.limit);
        const percent = Math.round(fraction * 100);
        return (
          <div key={group.pool} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{group.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {row.recentCount}/{row.limit} · {formatResetCountdown(row.resetAt, nowMs)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
              <div
                className="h-full rounded-full bg-foreground/70 transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="text-muted-foreground text-xs">
              {group.rows.map((entry) => `${entry.model} (${entry.recentCount}/${entry.limit})`).join(", ")}
            </div>
          </div>
        );
      })}

      {vm.freeWindows !== undefined && (
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">Sessions today</span>
          <span className="text-muted-foreground tabular-nums">
            {vm.freeWindows.dayUsed}/{vm.freeWindows.dayLimit} ·{" "}
            {formatResetCountdown(vm.freeWindows.dayResetAt, nowMs)}
          </span>
        </div>
      )}

      {vm.freebucksUnavailable ? (
        <div className="text-muted-foreground text-xs">
          Freebucks balance could not be refreshed — it will update on the next session poll.
        </div>
      ) : (
        vm.freebucks !== undefined && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">
                Freebucks
                {vm.quotaExempt && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
                    quota exempt
                  </span>
                )}
              </span>
              <span className="tabular-nums">
                {formatFreebucksBalance(vm.freebucks.balance)} available
              </span>
            </div>
            <div className="text-muted-foreground text-xs tabular-nums">
              Daily {formatFreebucksBalance(vm.freebucks.daily.remaining)} of{" "}
              {formatFreebucksBalance(vm.freebucks.daily.limit)} ·{" "}
              {formatResetCountdown(vm.freebucks.daily.resetAt, nowMs)} · Wallet{" "}
              {formatFreebucksBalance(vm.freebucks.wallet.balance)}
            </div>
          </div>
        )
      )}
    </div>
  );
}
