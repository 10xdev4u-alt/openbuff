import { describe, expect, it } from "vite-plus/test";

import type { FreebuffProviderUsage } from "@t3tools/contracts";

import {
  buildCockpitViewModel,
  formatFreebucksBalance,
  formatResetCountdown,
  groupQuotaRowsByPool,
  usageFraction,
} from "./freebuffCockpit.logic.ts";

describe("groupQuotaRowsByPool", () => {
  it("groups rows by the opaque pool token and keeps the server label", () => {
    const groups = groupQuotaRowsByPool({
      "deepseek/deepseek-v4-pro": {
        pool: "premium-day",
        poolLabel: "Premium sessions",
        limit: 5,
        recentCount: 2,
        resetAt: "2026-09-17T07:00:00.000Z",
      },
      "z-ai/glm-5.2": {
        pool: "premium-day",
        poolLabel: "Premium sessions",
        limit: 5,
        recentCount: 1,
        resetAt: "2026-09-17T07:00:00.000Z",
      },
      "mimo/mimo-v2.5": {
        pool: "reward-day",
        poolLabel: "Reward pool",
        limit: 3,
        recentCount: 0,
        resetAt: "2026-09-17T07:00:00.000Z",
      },
    });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.pool).toBe("premium-day");
    expect(groups[0]?.label).toBe("Premium sessions");
    expect(groups[0]?.rows.map((row) => row.model).sort()).toEqual([
      "deepseek/deepseek-v4-pro",
      "z-ai/glm-5.2",
    ]);
    expect(groups[1]?.pool).toBe("reward-day");
  });

  it("never matches on pool values — unknown tokens group by identity", () => {
    const groups = groupQuotaRowsByPool({
      "openai/gpt-5.6-luna": {
        pool: "some-future-pool",
        poolLabel: "Something new",
        limit: 9,
        recentCount: 0,
        resetAt: "2026-09-17T07:00:00.000Z",
      },
    });
    expect(groups[0]?.pool).toBe("some-future-pool");
    expect(groups[0]?.label).toBe("Something new");
  });

  it("gives pool-less rows (older servers) their own per-model group", () => {
    const groups = groupQuotaRowsByPool({
      "minimax/minimax-m3": {
        limit: 20,
        recentCount: 4,
        resetAt: "2026-09-17T07:00:00.000Z",
      },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("minimax/minimax-m3");
    expect(groups[0]?.rows).toHaveLength(1);
  });

  it("handles absent rateLimitsByModel", () => {
    expect(groupQuotaRowsByPool(undefined)).toEqual([]);
  });
});

describe("buildCockpitViewModel", () => {
  it("flags absent usage as no-meter (older server hint)", () => {
    const vm = buildCockpitViewModel(undefined);
    expect(vm.noMeter).toBe(true);
    expect(vm.poolGroups).toEqual([]);
    expect(vm.freebucksUnavailable).toBe(false);
  });

  it("distinguishes null freebucks (clear stale) from absent (no meter)", () => {
    const vm = buildCockpitViewModel({ freebucks: null });
    expect(vm.freebucksUnavailable).toBe(true);
    expect(vm.freebucks).toBeUndefined();
    expect(vm.noMeter).toBe(false);
  });

  it("surfaces quotaExempt only when the server declares it", () => {
    const exempt = buildCockpitViewModel({
      freebucks: {
        quotaExempt: true,
        balance: 5,
        daily: { limit: 5, spent: 0, remaining: 5, resetAt: "2026-09-17T07:00:00.000Z" },
        wallet: { balance: 0, monthlyBonus: 0 },
        planId: null,
        prices: {},
      },
    });
    expect(exempt.quotaExempt).toBe(true);
    const notExempt = buildCockpitViewModel({
      freebucks: {
        balance: 5,
        daily: { limit: 5, spent: 0, remaining: 5, resetAt: "2026-09-17T07:00:00.000Z" },
        wallet: { balance: 0, monthlyBonus: 0 },
        planId: null,
        prices: {},
      },
    });
    expect(notExempt.quotaExempt).toBe(false);
  });
});

describe("usageFraction", () => {
  it("clamps and never divides by zero", () => {
    expect(usageFraction(2, 5)).toBe(0.4);
    expect(usageFraction(9, 5)).toBe(1);
    expect(usageFraction(1, 0)).toBe(0);
    expect(usageFraction(-1, 5)).toBe(0);
  });
});

describe("formatResetCountdown", () => {
  const NOW = Date.parse("2026-09-16T12:00:00.000Z");
  it("renders minute granularity under an hour (no repaint loops)", () => {
    expect(formatResetCountdown("2026-09-16T12:05:30.000Z", NOW)).toBe("resets in 6m");
  });
  it("renders hours and minutes", () => {
    expect(formatResetCountdown("2026-09-16T14:30:00.000Z", NOW)).toBe("resets in 2h 30m");
  });
  it("renders days and hours", () => {
    expect(formatResetCountdown("2026-09-18T13:30:00.000Z", NOW)).toBe("resets in 2d 1h");
  });
  it("handles past and garbage instants", () => {
    expect(formatResetCountdown("2026-09-16T11:00:00.000Z", NOW)).toBe("resetting…");
    expect(formatResetCountdown("not-a-date", NOW)).toBe("reset time unknown");
  });
});

describe("formatFreebucksBalance", () => {
  it("keeps integers bare and trims phantom decimals", () => {
    expect(formatFreebucksBalance(12)).toBe("12");
    expect(formatFreebucksBalance(12.5)).toBe("12.5");
    expect(formatFreebucksBalance(12.25)).toBe("12.25");
  });
});
