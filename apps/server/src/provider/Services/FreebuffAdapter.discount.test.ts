/**
 * FreebuffAdapter — first-tab discount opt-in (issue #122, server half).
 *
 * Upstream discipline asserted against real fetch doubles: the opt-in header
 * is a STICKY account-level flag derived from the last captured quote —
 * `1` only once a quote has said `firstTabDiscount.available`, untouched by
 * quotes that omit freebucks entirely. The first-ever admission always opts
 * out (nothing has been offered yet). The SDK client is injected as a stub
 * whose run never resolves, so turns stay harmless no-ops while the
 * admission wire is exercised for real.
 *
 * @module provider/Services/FreebuffAdapter
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ThreadId } from "@t3tools/contracts";

import type { FreebuffSettings } from "@t3tools/contracts";

import { makeFreebuffAdapter } from "./FreebuffAdapter.ts";

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

const config = {
  enabled: true,
  apiKey: "test-key",
  agent: "codebuff/base@0.0.16",
  model: "",
} as unknown as FreebuffSettings;

const threadId = ThreadId.make("thread-discount-1");

const startInput = {
  threadId,
  runtimeMode: "full-access",
} as const;

/** Client stub: `run` rejects, so each turn completes (failed) and clears its seat. */
const failingRunClientFactory = async (): Promise<unknown> => ({
  run: () => Promise.reject(new Error("stub-run-failure")),
});

/**
 * Turn N's sendTurn resolves before the run-failure callback clears
 * `activeTurn` (forked Effects). Retry across that window — bounded, so a
 * genuinely wedged adapter still fails the test instead of hanging.
 */
async function sendTurnWhenFree(
  adapter: Awaited<ReturnType<typeof makeFreebuffAdapter>>,
  input: { threadId: typeof threadId; input: string },
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await Effect.runPromise(adapter.sendTurn(input));
      return;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("active turn")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("adapter never freed the active turn");
}

/** A real-shaped quote; `undefined` models a server that omits freebucks. */
function quoteWith(available: boolean): unknown {
  return {
    balance: 7,
    daily: { limit: 30, spent: 3, remaining: 27, resetAt: "2026-09-23T00:00:00Z" },
    wallet: { balance: 4, monthlyBonus: 0 },
    planId: null,
    prices: { "vendor/premium": 15 },
    listPrices: { "vendor/premium": 25 },
    firstTabDiscount: { amount: 10, available },
  };
}

/**
 * POST (admission) → active + optional quote; GET (poll) → 404 so every
 * second turn classifies `gone`, clears the seat, and re-admits — which is
 * exactly the upstream moment the sticky flag is re-read. Records POST
 * headers only.
 */
function makeDiscountFetch(freebucks: unknown): { fetch: typeof fetch; posts: Headers[] } {
  const posts: Headers[] = [];
  const fetch = asFetch(async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST") {
      posts.push(new Headers(init?.headers));
      return jsonResponse(200, {
        status: "active",
        instanceId: "inst-disc-1",
        model: "deepseek/deepseek-v4-flash",
        ...(freebucks !== undefined ? { freebucks } : {}),
      });
    }
    if (method === "DELETE") {
      return jsonResponse(200, { status: "none" });
    }
    return new Response(null, { status: 404 });
  });
  return { fetch, posts };
}

it.layer(NodeServices.layer)("FreebuffAdapter first-tab discount opt-in (#122)", (it) => {
  it.effect("first admission opts out; re-admission after an available offer opts in", () =>
    Effect.gen(function* () {
      const { fetch, posts } = makeDiscountFetch(quoteWith(true));
      const adapter = yield* makeFreebuffAdapter({
        config,
        instanceId: "freebuff-discount-test",
        fetchImpl: fetch,
        clientFactory: failingRunClientFactory,
      });

      yield* adapter.startSession(startInput);
      yield* Effect.promise(() => sendTurnWhenFree(adapter, { threadId, input: "first" }));
      expect(posts).toHaveLength(1);
      expect(posts[0]?.get("x-freebuff-first-tab-discount")).toBe("0");

      // Second turn: poll 404 → seat gone → re-admit with the captured offer.
      yield* Effect.promise(() => sendTurnWhenFree(adapter, { threadId, input: "second" }));
      expect(posts).toHaveLength(2);
      expect(posts[1]?.get("x-freebuff-first-tab-discount")).toBe("1");
    }),
  );

  it.effect("an unavailable offer never opts in", () =>
    Effect.gen(function* () {
      const { fetch, posts } = makeDiscountFetch(quoteWith(false));
      const adapter = yield* makeFreebuffAdapter({
        config,
        instanceId: "freebuff-discount-test",
        fetchImpl: fetch,
        clientFactory: failingRunClientFactory,
      });

      yield* adapter.startSession(startInput);
      yield* Effect.promise(() => sendTurnWhenFree(adapter, { threadId, input: "first" }));
      yield* Effect.promise(() => sendTurnWhenFree(adapter, { threadId, input: "second" }));
      expect(posts).toHaveLength(2);
      expect(posts[1]?.get("x-freebuff-first-tab-discount")).toBe("0");
    }),
  );

  it.effect("a quote without freebucks leaves the opt-out untouched", () =>
    Effect.gen(function* () {
      const { fetch, posts } = makeDiscountFetch(undefined);
      const adapter = yield* makeFreebuffAdapter({
        config,
        instanceId: "freebuff-discount-test",
        fetchImpl: fetch,
        clientFactory: failingRunClientFactory,
      });

      yield* adapter.startSession(startInput);
      yield* Effect.promise(() => sendTurnWhenFree(adapter, { threadId, input: "first" }));
      yield* Effect.promise(() => sendTurnWhenFree(adapter, { threadId, input: "second" }));
      expect(posts).toHaveLength(2);
      expect(posts[1]?.get("x-freebuff-first-tab-discount")).toBe("0");
    }),
  );
});
