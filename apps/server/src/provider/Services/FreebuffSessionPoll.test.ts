// @effect-diagnostics globalDate:off
// Plain (non-Effect) module: poll timing comes from server payloads (not
// wall-clock scheduling), and the only Date.now() use is retry-after header
// decoding — same sanctioned opt-out as FreebuffSession.ts.
import { describe, it, expect } from "@effect/vitest";

import {
  pollFreebuffSession,
  classifySessionPoll,
  FREEBUFF_SESSION_PATH,
} from "./FreebuffSession.js";
import type { FreebuffSessionResponse } from "./FreebuffSession.js";
import { FreebuffSessionRequestError } from "./FreebuffSession.js";

/** Minimal fetch double: records the request, replies with a canned response. */
function makeFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
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

describe("pollFreebuffSession — GET wire contract", () => {
  it("GETs the session path with instance + compact headers, body-less", async () => {
    const { fetchImpl, calls } = makeFetch(200, {
      status: "active",
      instanceId: "inst_1",
    });
    await pollFreebuffSession("tok", "inst_1", { fetch: fetchImpl });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(`https://www.codebuff.com${FREEBUFF_SESSION_PATH}`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok");
    expect(headers["x-freebuff-instance-id"]).toBe("inst_1");
    expect(headers["x-freebuff-compact-session"]).toBe("1");
  });

  it("maps 404 to a none status (row swept / no session)", async () => {
    const { fetchImpl } = makeFetch(404, { error: "not_found" });
    const res = await pollFreebuffSession("tok", "inst_1", { fetch: fetchImpl });
    expect(res).toEqual({ status: "none" });
  });

  it("throws a typed error on hard failures with retry-after parsed", async () => {
    const { fetchImpl } = makeFetch(500, { error: "boom" }, { "retry-after": "7" });
    const err = await pollFreebuffSession("tok", "inst_1", { fetch: fetchImpl }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FreebuffSessionRequestError);
    const typed = err as FreebuffSessionRequestError;
    expect(typed.status).toBe(500);
    expect(typed.errorCode).toBe("boom");
    expect(typed.retryAfterMs).toBe(7_000);
  });

  it("returns terminal 403 bodies for classification", async () => {
    const { fetchImpl } = makeFetch(403, { status: "banned" });
    const res = await pollFreebuffSession("tok", "inst_1", { fetch: fetchImpl });
    expect(res.status).toBe("banned");
  });
});

describe("classifySessionPoll — upstream grace semantics", () => {
  const base: FreebuffSessionResponse = { status: "active" };

  it("active with instanceId → active", () => {
    expect(classifySessionPoll({ ...base, instanceId: "i" })).toEqual({
      kind: "active",
      instanceId: "i",
    });
  });

  it("ended WITH instanceId → grace (chat finishes, no new prompts)", () => {
    const result = classifySessionPoll({
      status: "ended",
      instanceId: "i",
      gracePeriodEndsAt: "2026-09-16T12:00:00Z",
      gracePeriodRemainingMs: 60_000,
    });
    expect(result.kind).toBe("grace");
    if (result.kind === "grace") {
      expect(result.graceRemainingMs).toBe(60_000);
    }
  });

  it("ended WITHOUT instanceId → gone (rejoin via admission POST)", () => {
    expect(classifySessionPoll({ status: "ended" }).kind).toBe("gone");
  });

  it("none → gone", () => {
    expect(classifySessionPoll({ status: "none" }).kind).toBe("gone");
  });

  it("superseded → superseded (seat taken)", () => {
    expect(classifySessionPoll({ status: "superseded" }).kind).toBe("superseded");
  });

  it("terminal account states classify as blocked", () => {
    expect(classifySessionPoll({ status: "banned" }).kind).toBe("blocked");
    expect(classifySessionPoll({ status: "country_blocked" }).kind).toBe("blocked");
  });

  it("unknown statuses fall through as unknown (never crash a live session)", () => {
    expect(classifySessionPoll({ status: "maintenance_mode" }).kind).toBe("unknown");
    expect(classifySessionPoll({ status: "maintenance_mode" }).kind).not.toBe("gone");
  });
});
