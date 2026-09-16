import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { FreebuffCockpit } from "./FreebuffCockpit";

const FREEBUFF_DRIVER = ProviderDriverKind.make("freebuff");

function freebuffProvider(usage: ServerProvider["usage"]): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("freebuff"),
    driver: FREEBUFF_DRIVER,
    displayName: "Freebuff",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-16T00:00:00.000Z",
    models: [],
    ...(usage !== undefined ? { usage } : {}),
  };
}

const FULL_USAGE: NonNullable<ServerProvider["usage"]> = {
  rateLimitsByModel: {
    "deepseek/deepseek-v4-pro": {
      pool: "premium-day",
      poolLabel: "Premium sessions",
      limit: 5,
      recentCount: 2,
      resetAt: "2026-09-17T07:00:00.000Z",
    },
    "z-ai/glm-5.2": {
      pool: "reward-day",
      poolLabel: "Reward pool",
      limit: 3,
      recentCount: 1,
      resetAt: "2026-09-17T07:00:00.000Z",
    },
  },
  freeWindows: {
    dayUsed: 2,
    dayLimit: 8,
    weekUsed: 5,
    weekLimit: 40,
    monthUsed: 11,
    monthLimit: 120,
    dayResetAt: "2026-09-17T07:00:00.000Z",
    monthResetAt: "2026-10-01T07:00:00.000Z",
  },
  freebucks: {
    balance: 12.5,
    daily: { limit: 10, spent: 4, remaining: 6, resetAt: "2026-09-17T07:00:00.000Z" },
    wallet: { balance: 6.5, monthlyBonus: 0 },
    planId: null,
    prices: { "openai/gpt-5.6-luna": 2 },
  },
};

describe("FreebuffCockpit", () => {
  it("renders nothing without a usage block (older servers)", () => {
    const markup = renderToStaticMarkup(
      <FreebuffCockpit providers={[freebuffProvider(undefined)]} />,
    );
    expect(markup).toBe("");
  });

  it("renders pool groups with server labels, counts and model breakdowns", () => {
    const markup = renderToStaticMarkup(
      <FreebuffCockpit providers={[freebuffProvider(FULL_USAGE)]} />,
    );
    expect(markup).toContain("Premium sessions");
    expect(markup).toContain("Reward pool");
    expect(markup).toContain("2/5");
    expect(markup).toContain("deepseek/deepseek-v4-pro (2/5)");
    expect(markup).toContain("resets in");
  });

  it("renders free windows and freebucks balances", () => {
    const markup = renderToStaticMarkup(
      <FreebuffCockpit providers={[freebuffProvider(FULL_USAGE)]} />,
    );
    expect(markup).toContain("Sessions today");
    expect(markup).toContain("2/8");
    expect(markup).toContain("12.5 available");
    expect(markup).toContain("Wallet 6.5");
  });

  it("clears stale freebucks on null (refresh-failed notice, no balance shown)", () => {
    const markup = renderToStaticMarkup(
      <FreebuffCockpit providers={[freebuffProvider({ freebucks: null })]} />,
    );
    expect(markup).toContain("could not be refreshed");
    expect(markup).not.toContain("available");
  });

  it("flags quota-exempt accounts", () => {
    const markup = renderToStaticMarkup(
      <FreebuffCockpit
        providers={[
          freebuffProvider({
            freebucks: {
              quotaExempt: true,
              balance: 3,
              daily: { limit: 3, spent: 0, remaining: 3, resetAt: "2026-09-17T07:00:00.000Z" },
              wallet: { balance: 0, monthlyBonus: 0 },
              planId: null,
              prices: {},
            },
          }),
        ]}
      />,
    );
    expect(markup).toContain("quota exempt");
  });
});
