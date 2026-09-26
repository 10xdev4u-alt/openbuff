/**
 * FreebuffAdapter — admission/suite model coherence (the mismatch class).
 *
 * Upstream's chat-completions session gate rejects any request whose model
 * differs from the admitted session's (`session_model_mismatch`). The
 * adapter therefore must never let its two model-consuming call sites
 * disagree: the ADMISSION header (`x-freebuff-model`) and the AGENT SUITE
 * (`makeFreebuffAgentSuite`) are decided from the same user pick, but the
 * suite coerces unknown/withdrawn models to the tier default while — before
 * this contract — admission forwarded the pick RAW. A pick outside the
 * pairing map (upstream ships a row before we reconcile, a released binary
 * holds a withdrawn id) would then admit successfully on the raw model and
 * run the default pair, dying on every turn.
 *
 * Contract: admission sends the pick ONLY when the pairing map can serve it
 * (picker rows AND drain rows); anything else resolves to `undefined` and
 * the session layer's own fallback pins the explicit tier default — the
 * same model the suite's coercion lands on. An absent selection behaves as
 * today (explicit default).
 *
 * @module provider/Services/FreebuffAdapter
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import type { FreebuffSettings } from "@t3tools/contracts";

import { makeFreebuffAdapter } from "./FreebuffAdapter.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";
import type { ProviderAdapterError } from "../Errors.ts";

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

const threadId = ThreadId.make("thread-coherence-1");

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
 * `activeTurn` (forked Effects). Retry across that window — bounded.
 */
async function sendTurnWhenFree(
  adapter: ProviderAdapterShape<ProviderAdapterError>,
  input: { threadId: typeof threadId; input: string; modelSelection?: unknown },
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await Effect.runPromise(adapter.sendTurn(input as never));
      return;
    } catch (error: unknown) {
      if (!(error instanceof Error) || !error.message.includes("active turn")) {
        throw error;
      }
      await Effect.runPromise(Effect.sleep("10 millis"));
    }
  }
  throw new Error("adapter never freed the active turn");
}

/**
 * POST (admission) → active; GET (poll) → 404; DELETE → none. Records POST
 * headers so each case can assert the `x-freebuff-model` decision.
 */
function makeCoherenceFetch(): { fetch: typeof fetch; posts: Headers[] } {
  const posts: Headers[] = [];
  const fetch = asFetch(async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST") {
      posts.push(new Headers(init?.headers));
      return jsonResponse(200, {
        status: "active",
        instanceId: "inst-coherence-1",
        model: "z-ai/glm-5.3-flash",
      });
    }
    if (method === "DELETE") {
      return jsonResponse(200, { status: "none" });
    }
    return new Response(null, { status: 404 });
  });
  return { fetch, posts };
}

const selection = (model: string): unknown => ({
  instanceId: ProviderInstanceId.make("freebuff-coherence-test"),
  model,
});

it.layer(NodeServices.layer)(
  "FreebuffAdapter admission/suite model coherence",
  (it) => {
    const makeAdapter = (wiredFetch: typeof fetch) =>
      makeFreebuffAdapter({
        config,
        instanceId: "freebuff-coherence-test",
        fetchImpl: wiredFetch,
        clientFactory: failingRunClientFactory,
      });

    it.effect("admits with the raw pick when the pairing map can serve it", () =>
      Effect.gen(function* () {
        // Picker rows AND drain rows AND tier-locked rows (#143, #166
        // doctrine): all are ADMITTING — the lock is per-viewer, resolved by
        // the server — so the header carries the pick itself and upstream
        // serves (or refuses, per viewer) exactly what was admitted.
        for (const model of [
          "upstage/solar-mini4",
          "upstage/solar-pro4",
          "openai/gpt-6-luna",
          "z-ai/glm-5.3-flash",
        ]) {
          const { fetch, posts } = makeCoherenceFetch();
          const adapter = yield* makeAdapter(fetch);
          yield* adapter.startSession(startInput);
          yield* Effect.promise(() =>
            sendTurnWhenFree(adapter, {
              threadId,
              input: `serve ${model}`,
              modelSelection: selection(model),
            }),
          );
          expect(posts).toHaveLength(1);
          expect(posts[0]?.get("x-freebuff-model"), model).toBe(model);
        }
      }),
    );

    it.effect("never admits a model the map cannot serve — the header lands on the default", () =>
      Effect.gen(function* () {
        // Withdrawn and unknown ids coerce to the default in the agent
        // suite; the admission header must land on the SAME model. The
        // adapter resolves the pick through resolveFreebuffServedModel, gets
        // `undefined` for unservable ids, and the session layer's own
        // fallback pins the explicit tier default — so both legs run
        // glm-5.3-flash and the session gate never sees a mismatch.
        for (const dead of [
          "stealth/ox-alpha",
          "minimax/minimax-m3",
          "openai/gpt-5.6-luna",
          "acme/nonexistent",
        ]) {
          const { fetch, posts } = makeCoherenceFetch();
          const adapter = yield* makeAdapter(fetch);
          yield* adapter.startSession(startInput);
          yield* Effect.promise(() =>
            sendTurnWhenFree(adapter, {
              threadId,
              input: `coerce ${dead}`,
              modelSelection: selection(dead),
            }),
          );
          expect(posts).toHaveLength(1);
          expect(posts[0]?.get("x-freebuff-model"), dead).toBe("z-ai/glm-5.3-flash");
        }
      }),
    );

    it.effect("keeps today's shape: an absent selection admits with the explicit tier default", () =>
      Effect.gen(function* () {
        const { fetch, posts } = makeCoherenceFetch();
        const adapter = yield* makeAdapter(fetch);
        yield* adapter.startSession(startInput);
        yield* Effect.promise(() => sendTurnWhenFree(adapter, { threadId, input: "no selection" }));
        expect(posts).toHaveLength(1);
        expect(posts[0]?.get("x-freebuff-model")).toBe("z-ai/glm-5.3-flash");
      }),
    );
  },
);
