import { describe, expect, it } from "vite-plus/test";

import {
  establishFreebuffSession,
  pollFreebuffSession,
} from "./FreebuffSession.ts";

type QuotaRow = {
  pool?: string;
  poolLabel?: string;
  limit: number;
  recentCount: number;
  resetAt: string;
};

const QUOTA_BODY = {
  status: "active",
  instanceId: "inst-1",
  model: "deepseek/deepseek-v4-flash",
  rateLimitsByModel: {
    "deepseek/deepseek-v4-pro": {
      pool: "premium-day",
      poolLabel: "Premium sessions",
      limit: 5,
      recentCount: 1,
      resetAt: "2026-09-17T07:00:00Z",
    },
  } satisfies Record<string, QuotaRow>,
  freeWindows: {
    dayUsed: 1,
    dayLimit: 8,
    weekUsed: 3,
    weekLimit: 40,
    monthUsed: 9,
    monthLimit: 120,
    dayResetAt: "2026-09-17T07:00:00Z",
    monthResetAt: "2026-10-01T07:00:00Z",
  },
  freebucks: {
    quotaExempt: false,
    balance: 12.5,
    daily: {
      limit: 10,
      spent: 4,
      remaining: 6,
      resetAt: "2026-09-17T07:00:00Z",
      resetTimeZone: "America/Los_Angeles",
    },
    wallet: { balance: 6.5, monthlyBonus: 0 },
    planId: null,
    prices: { "openai/gpt-5.6-luna": 2 },
  },
};

const NO_METER_BODY = {
  status: "active",
  instanceId: "inst-2",
  model: "deepseek/deepseek-v4-flash",
};

const NULL_FREEBUCKS_BODY = {
  status: "active",
  instanceId: "inst-3",
  model: "deepseek/deepseek-v4-flash",
  rateLimitsByModel: QUOTA_BODY.rateLimitsByModel,
  freebucks: null,
};

/** The doubles satisfy the wire contract; Bun's fetch type carries extra members we never use. */
function asFetch(fn: (url: string | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return fn as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("session surfaces usage blocks", () => {
  it("admission: freeWindows + freebucks pass through untouched", async () => {
    const res = await establishFreebuffSession("tok", {
      fetch: asFetch(async () => jsonResponse(200, QUOTA_BODY)),
    });
    expect(res.status).toBe("active");
    expect(res.freeWindows).toEqual(QUOTA_BODY.freeWindows);
    expect(res.freebucks).toEqual(QUOTA_BODY.freebucks);
    expect(res.rateLimitsByModel).toEqual(QUOTA_BODY.rateLimitsByModel);
  });

  it("admission: absent meter fields stay absent (older servers)", async () => {
    const res = await establishFreebuffSession("tok", {
      fetch: asFetch(async () => jsonResponse(200, NO_METER_BODY)),
    });
    expect(res.freeWindows).toBeUndefined();
    expect(res.freebucks).toBeUndefined();
  });

  it("poll: null freebucks survives as null (clears stale balances)", async () => {
    const res = await pollFreebuffSession("tok", "inst-3", {
      fetch: asFetch(async () => jsonResponse(200, NULL_FREEBUCKS_BODY)),
    });
    expect(res.status).toBe("active");
    expect(res.freebucks).toBeNull();
    expect(res.rateLimitsByModel).toEqual(QUOTA_BODY.rateLimitsByModel);
  });

  it("poll: full usage block passes through untouched", async () => {
    const res = await pollFreebuffSession("tok", "inst-1", {
      fetch: asFetch(async () => jsonResponse(200, QUOTA_BODY)),
    });
    expect(res.freeWindows).toEqual(QUOTA_BODY.freeWindows);
    expect(res.freebucks).toEqual(QUOTA_BODY.freebucks);
  });
});
