import { describe, expect, it } from "vite-plus/test";

import { establishFreebuffSession, pollFreebuffSession } from "./FreebuffSession.ts";

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
    "z-ai/glm-5.2": {
      limit: 100,
      recentCount: 0,
      resetAt: "2026-09-17T07:00:00Z",
    },
  } satisfies Record<string, QuotaRow>,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The doubles satisfy the wire contract; Bun's fetch type carries extra members we never use. */
function asFetch(fn: (url: string | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return fn as unknown as typeof fetch;
}

describe("session surfaces rateLimitsByModel", () => {
  it("admission: active body passes the quota rows through untouched", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const res = await establishFreebuffSession("tok", {
      fetch: asFetch(async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse(200, QUOTA_BODY);
      }),
    });
    expect(res.status).toBe("active");
    expect(res.rateLimitsByModel).toEqual(QUOTA_BODY.rateLimitsByModel);
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("admission: gate body (409 model_unavailable) passes quota rows through", async () => {
    const res = await establishFreebuffSession("tok", {
      fetch: asFetch(async () =>
        jsonResponse(409, {
          status: "model_unavailable",
          requestedModel: "openai/gpt-5.6-luna",
          availableHours: "usually 09:00–17:00 UTC",
          rateLimitsByModel: QUOTA_BODY.rateLimitsByModel,
        })),
    });
    expect(res.status).toBe("model_unavailable");
    expect(res.rateLimitsByModel).toEqual(QUOTA_BODY.rateLimitsByModel);
  });

  it("poll: active body passes the quota rows through untouched", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const res = await pollFreebuffSession("tok", "inst-1", {
      fetch: asFetch(async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse(200, QUOTA_BODY);
      }),
    });
    expect(res.status).toBe("active");
    expect(res.rateLimitsByModel).toEqual(QUOTA_BODY.rateLimitsByModel);
    expect(calls[0]?.init.method).toBe("GET");
  });

  it("admission: absent quota field stays absent", async () => {
    const res = await establishFreebuffSession("tok", {
      fetch: asFetch(async () => jsonResponse(200, { status: "active", instanceId: "inst-2" })),
    });
    expect(res.rateLimitsByModel).toBeUndefined();
  });
});
