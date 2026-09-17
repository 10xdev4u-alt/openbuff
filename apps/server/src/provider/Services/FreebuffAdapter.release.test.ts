/**
 * FreebuffAdapter — explicit session release on stop (issue #55, server half).
 *
 * Wire discipline asserted against real fetch doubles: stopping a session we
 * own DELETEs the upstream seat (never throws), a `superseded` gate must NOT
 * re-release upstream (another client owns the seat), and a session that
 * never admitted has nothing to release. The SDK client is injected as a
 * stub whose run never resolves, so the forked turn stays a harmless no-op
 * while admissions themselves are exercised for real.
 *
 * @module provider/Services/FreebuffAdapter
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ThreadId } from "@t3tools/contracts";

import type { FreebuffSettings } from "@t3tools/contracts";

import {
  makeFreebuffAdapter,
} from "./FreebuffAdapter.ts";
import { FREEBUFF_API_BASE } from "./FreebuffSession.ts";

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

const threadId = ThreadId.make("thread-release-1");

const startInput = {
  threadId,
  runtimeMode: "full-access",
} as const;

/** Client stub: `run` never resolves, so the forked turn fiber stays parked. */
const neverRunClientFactory = async (): Promise<unknown> => ({
  run: () => new Promise<never>(() => {}),
});

interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** Admission active, DELETE release. Returns the recorded call log. */
function makeSessionFetch(): { fetch: typeof fetch; calls: Array<RecordedCall> } {
  const calls: Array<RecordedCall> = [];
  const fetch = asFetch(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST") {
      return jsonResponse(200, {
        status: "active",
        instanceId: "inst-release-1",
        model: "deepseek/deepseek-v4-flash",
      });
    }
    if (method === "DELETE") {
      return jsonResponse(200, { status: "none" });
    }
    return jsonResponse(200, {
      status: "active",
      instanceId: "inst-release-1",
      model: "deepseek/deepseek-v4-flash",
    });
  });
  return { fetch, calls };
}

it.layer(NodeServices.layer)("FreebuffAdapter stop → upstream release (#55)", (it) => {
  it.effect("stopping an owned session DELETEs the upstream seat", () =>
    Effect.gen(function* () {
      const { fetch, calls } = makeSessionFetch();
      const adapter = yield* makeFreebuffAdapter({
        config,
        instanceId: "freebuff-release-test",
        fetchImpl: fetch,
        clientFactory: neverRunClientFactory,
      });

      yield* adapter.startSession(startInput);
      // Admission runs inline inside the first sendTurn, so once this
      // resolves the seat exists upstream and `freebuffInstanceId` is set.
      yield* adapter.sendTurn({ threadId, input: "hello" });

      yield* adapter.stopSession(threadId);

      const deletes = calls.filter((call) => (call.init.method ?? "").toUpperCase() === "DELETE");
      expect(deletes).toHaveLength(1);
      expect(deletes[0]?.url).toBe(`${FREEBUFF_API_BASE}/api/v1/freebuff/session`);
      const headers = new Headers(deletes[0]?.init.headers);
      expect(headers.get("authorization")).toBe("Bearer test-key");
      expect(headers.get("x-freebuff-instance-id")).toBe("inst-release-1");
      expect(yield* adapter.hasSession(threadId)).toBe(false);
    }),
  );

  it.effect("stopping a never-admitted session makes no upstream calls", () =>
    Effect.gen(function* () {
      const { fetch, calls } = makeSessionFetch();
      const adapter = yield* makeFreebuffAdapter({
        config,
        instanceId: "freebuff-release-test",
        fetchImpl: fetch,
        clientFactory: neverRunClientFactory,
      });

      yield* adapter.startSession(startInput);
      yield* adapter.stopSession(threadId);

      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("a superseded session is not re-released upstream", () =>
    Effect.gen(function* () {
      const calls: Array<RecordedCall> = [];
      // Admission answer: another client owns the seat.
      const fetch = asFetch(async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse(200, { status: "superseded" });
      });
      const adapter = yield* makeFreebuffAdapter({
        config,
        instanceId: "freebuff-release-test",
        fetchImpl: fetch,
        clientFactory: neverRunClientFactory,
      });

      yield* adapter.startSession(startInput);
      const failed = yield* Effect.exit(adapter.sendTurn({ threadId, input: "hello" }));
      expect(failed._tag).toBe("Failure");

      yield* adapter.stopSession(threadId);

      const deletes = calls.filter((call) => (call.init.method ?? "").toUpperCase() === "DELETE");
      expect(deletes).toHaveLength(0);
    }),
  );

  it.effect("release failures never fail stopSession", () =>
    Effect.gen(function* () {
      // Transport must be healthy for admission; only the DELETE throws, so
      // this isolates exactly the release-failure tolerance under test.
      const calls: Array<RecordedCall> = [];
      const fetch = asFetch(async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        if ((init?.method ?? "").toUpperCase() === "DELETE") {
          throw new TypeError("network down");
        }
        return jsonResponse(200, {
          status: "active",
          instanceId: "inst-release-1",
          model: "deepseek/deepseek-v4-flash",
        });
      });
      const adapter = yield* makeFreebuffAdapter({
        config,
        instanceId: "freebuff-release-test",
        fetchImpl: fetch,
        clientFactory: neverRunClientFactory,
      });

      yield* adapter.startSession(startInput);
      yield* adapter.sendTurn({ threadId, input: "hello" });

      // Must resolve despite the DELETE throwing.
      yield* adapter.stopSession(threadId);
      expect(yield* adapter.hasSession(threadId)).toBe(false);
    }),
  );
});