import { describe, it, expect } from "@effect/vitest";

import {
  establishFreebuffSession,
  FreebuffSessionRequestError,
  FREEBUFF_SESSION_ADMISSION_PATH,
  FREEBUFF_SESSION_UNSUPPORTED_MESSAGE,
} from "./FreebuffSession.js";

/** Minimal fetch double: records the request, replies with a canned response. */
function makeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers,
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const ACTIVE = {
  status: "active",
  instanceId: "inst_123",
  model: "z-ai/glm-5.3-flash",
  expiresAt: "2026-09-16T12:00:00Z",
  remainingMs: 600_000,
};

describe("establishFreebuffSession — wire contract", () => {
  it("POSTs the dedicated admission path, body-less, with the upstream header set", async () => {
    const { fetchImpl, calls } = makeFetch(200, ACTIVE);
    await establishFreebuffSession("tok", { fetch: fetchImpl });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(`https://www.codebuff.com${FREEBUFF_SESSION_ADMISSION_PATH}`);
    expect(init.method).toBe("POST");
    // Upstream POSTs are body-less — no JSON, no Content-Type.
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok");
    expect(headers["x-fb-timezone"]).toBeTruthy();
    expect(headers["x-freebuff-first-tab-discount"]).toBe("0");
    expect(headers["x-freebuff-model"]).toBe("z-ai/glm-5.3-flash");
    expect(headers["x-freebuff-wallet-spend-limit"]).toBe("0");
    // The instance header belongs to GET/DELETE only; POST must not send it.
    expect(headers["x-freebuff-instance-id"]).toBeUndefined();
  });

  it("sends first-tab discount as 1 when opted in and forwards a spend limit", async () => {
    const { fetchImpl, calls } = makeFetch(200, ACTIVE);
    await establishFreebuffSession("tok", {
      fetch: fetchImpl,
      firstTabDiscount: true,
      walletSpendLimit: 5,
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-freebuff-first-tab-discount"]).toBe("1");
    expect(headers["x-freebuff-wallet-spend-limit"]).toBe("5");
  });

  it("round-trips an active admission", async () => {
    const { fetchImpl } = makeFetch(200, ACTIVE);
    const res = await establishFreebuffSession("tok", { fetch: fetchImpl });
    expect(res.status).toBe("active");
    if (res.status === "active") {
      expect(res.instanceId).toBe("inst_123");
    }
  });

  // #122: the quote's discount fields must survive the projection. The wire
  // casts into FreebuffSessionResponse, so this guards the interface against
  // ever dropping them (a field-strict projection would silently break the
  // strike-through + opt-in consumers downstream).
  it("projection keeps listPrices + firstTabDiscount from the wire (#122)", async () => {
    const { fetchImpl } = makeFetch(200, {
      ...ACTIVE,
      freebucks: {
        balance: 7,
        daily: { limit: 30, spent: 3, remaining: 27, resetAt: "2026-09-23T00:00:00Z" },
        wallet: { balance: 4, monthlyBonus: 0 },
        planId: null,
        prices: { "vendor/premium": 15 },
        listPrices: { "vendor/premium": 25 },
        firstTabDiscount: { amount: 10, available: true },
      },
    });
    const res = await establishFreebuffSession("tok", { fetch: fetchImpl });
    expect(res.status).toBe("active");
    if (res.status !== "active" || res.freebucks === undefined || res.freebucks === null) {
      throw new Error("expected an active admission carrying freebucks");
    }
    expect(res.freebucks.listPrices).toEqual({ "vendor/premium": 25 });
    expect(res.freebucks.firstTabDiscount).toEqual({ amount: 10, available: true });
  });
});

describe("establishFreebuffSession — gate statuses return, terminal errors throw", () => {
  it("returns 403 country_blocked / banned bodies", async () => {
    for (const status of ["country_blocked", "banned"]) {
      const { fetchImpl } = makeFetch(403, { status, message: "nope" });
      const res = await establishFreebuffSession("tok", { fetch: fetchImpl });
      expect(res.status).toBe(status);
    }
  });

  it("returns 409 conflict-class bodies", async () => {
    for (const status of [
      "model_locked",
      "model_unavailable",
      "first_tab_discount_changed",
      "consent_required",
    ]) {
      const { fetchImpl } = makeFetch(409, { status });
      const res = await establishFreebuffSession("tok", { fetch: fetchImpl });
      expect(res.status).toBe(status);
    }
  });

  it("returns 429 quota-class bodies", async () => {
    for (const status of ["rate_limited", "spend_limited", "ip_capped"]) {
      const { fetchImpl } = makeFetch(429, { status });
      const res = await establishFreebuffSession("tok", { fetch: fetchImpl });
      expect(res.status).toBe(status);
    }
  });

  it("throws a typed error with machine-readable code + retry-after on hard failures", async () => {
    const { fetchImpl } = makeFetch(500, { error: "internal" }, { "retry-after": "30" });
    const err = await establishFreebuffSession("tok", { fetch: fetchImpl }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FreebuffSessionRequestError);
    const typed = err as FreebuffSessionRequestError;
    expect(typed.status).toBe(500);
    expect(typed.errorCode).toBe("internal");
    expect(typed.retryAfterMs).toBe(30_000);
    expect(typed.message).toContain("500");
  });

  it("treats 404/405 on the admission route as an unsupported server", async () => {
    for (const status of [404, 405]) {
      const { fetchImpl } = makeFetch(status, {});
      const err = await establishFreebuffSession("tok", { fetch: fetchImpl }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(FreebuffSessionRequestError);
      expect((err as FreebuffSessionRequestError).errorCode).toBe("session_admission_unsupported");
      expect((err as FreebuffSessionRequestError).message).toBe(
        FREEBUFF_SESSION_UNSUPPORTED_MESSAGE,
      );
    }
  });
});

describe("retry-after parsing", () => {
  it("parses seconds values into ms, rejects junk", async () => {
    for (const seconds of [0, 1, 30, 3_600, 86_400]) {
      const { fetchImpl } = makeFetch(503, {}, { "retry-after": String(seconds) });
      const err = (await establishFreebuffSession("tok", {
        fetch: fetchImpl,
      }).then(
        () => null,
        (e: unknown) => e,
      )) as FreebuffSessionRequestError;
      expect(err.retryAfterMs).toBe(seconds * 1_000);
    }
    const { fetchImpl } = makeFetch(503, {}, { "retry-after": "garbage" });
    const err = (await establishFreebuffSession("tok", { fetch: fetchImpl }).then(
      () => null,
      (e: unknown) => e,
    )) as FreebuffSessionRequestError;
    expect(err.retryAfterMs).toBeUndefined();
  });
});
