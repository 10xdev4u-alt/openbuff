import { describe, expect, it } from "vite-plus/test";

import { type FreebuffProviderUsage, mergeProviderUsage, usageFromSessionResponse } from "./providerUsageMerge.ts";

describe("mergeProviderUsage", () => {
  const base: FreebuffProviderUsage = {
    rateLimitsByModel: {
      "deepseek/deepseek-v4-pro": {
        pool: "premium-day",
        poolLabel: "Premium sessions",
        limit: 5,
        recentCount: 2,
        resetAt: "2026-09-17T07:00:00.000Z",
      },
    },
    freeWindows: {
      dayUsed: 1,
      dayLimit: 8,
      weekUsed: 3,
      weekLimit: 40,
      monthUsed: 9,
      monthLimit: 120,
      dayResetAt: "2026-09-17T07:00:00.000Z",
      monthResetAt: "2026-10-01T07:00:00.000Z",
    },
    freebucks: {
      balance: 12.5,
      daily: { limit: 10, spent: 4, remaining: 6, resetAt: "2026-09-17T07:00:00.000Z" },
      wallet: { balance: 6.5, monthlyBonus: 0 },
      planId: null,
      prices: {},
    },
  };

  it("replaces wholesale with the freshest capture", () => {
    const next = mergeProviderUsage(base, {
      rateLimitsByModel: {},
      freebucks: null,
    });
    expect(next).toEqual({ rateLimitsByModel: {}, freebucks: null });
  });

  it("keeps the prior capture when the adapter has none", () => {
    expect(mergeProviderUsage(base, undefined)).toEqual(base);
  });

  it("round-trips absent to absent", () => {
    expect(mergeProviderUsage(undefined, undefined)).toBeUndefined();
  });

  it("adopts the first capture after an empty snapshot", () => {
    const adopted = mergeProviderUsage(undefined, base);
    expect(adopted).toEqual(base);
  });
});

describe("usageFromSessionResponse", () => {
  it("returns undefined when the body carries no meter fields (older servers)", () => {
    expect(usageFromSessionResponse({ status: "active" })).toBeUndefined();
  });

  it("captures every present field wholesale", () => {
    const usage = usageFromSessionResponse({
      status: "active",
      rateLimitsByModel: { "z-ai/glm-5.2": { limit: 100, recentCount: 0, resetAt: "x" } },
      freeWindows: { dayUsed: 1, dayLimit: 8, weekUsed: 2, weekLimit: 40, monthUsed: 3, monthLimit: 120, dayResetAt: "a", monthResetAt: "b" },
      freebucks: null,
    });
    expect(usage?.freebucks).toBeNull();
    expect(usage?.rateLimitsByModel).toBeDefined();
    expect(usage?.freeWindows).toBeDefined();
  });

  it("captures a lone null freebucks so stale balances get cleared", () => {
    const usage = usageFromSessionResponse({ status: "active", freebucks: null });
    expect(usage).toEqual({ freebucks: null });
  });
});
