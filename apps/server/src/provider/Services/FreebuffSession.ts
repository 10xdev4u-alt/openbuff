/**
 * FreebuffSession — free-tier session admission + request tie-in.
 *
 * Freebuff's backend gates every free-mode chat completion behind THREE
 * checks, all of which must pass or the turn dies silently:
 *
 *   1. The system prompt opens with a canonical first-party marker
 *      ("You are Buffy, the coding agent behind Codebuff."). See the
 *      agent definition in FreebuffAdapter.ts.
 *   2. The agent id + model combo is on the free-mode allowlist. The
 *      adapter supplies a local `base3-free-deepseek-flash` template pinned
 *      to `deepseek/deepseek-v4-flash`.
 *   3. An ACTIVE free session, tied to the request via
 *      `codebuff_metadata.freebuff_instance_id`. Without it the backend
 *      answers `waiting_room_required`.
 *
 * `@codebuff/sdk` handles the agent run and the `/api/v1/agent-runs`
 * lifecycle, but it has no notion of the free-session admission endpoint and
 * cannot inject `freebuff_instance_id` into `codebuff_metadata`. This module
 * supplies both:
 *
 *   - `establishFreebuffSession` POSTs `/api/v1/freebuff/session` (the same
 *     call the Freebuff CLI makes) and returns the server-assigned
 *     `instanceId`.
 *   - `installFreebuffFetchInterceptor` wraps `globalThis.fetch` once. The
 *     SDK resolves `globalThis.fetch` lazily at request time, so the wrapper
 *     sees every chat-completion request and merges `freebuff_instance_id`
 *     into its `codebuff_metadata`. The instance id is read from an
 *     `AsyncLocalStorage` scope so concurrent turns never cross-contaminate.
 *
 * The wire protocol here was verified against the live backend and matches
 * the reference Freebuff2API bridges.
 *
 * @module provider/Services/FreebuffSession
 */
import { AsyncLocalStorage } from "node:async_hooks";
import * as Crypto from "node:crypto";

export const FREEBUFF_API_BASE = "https://www.codebuff.com";

/**
 * The model this account is entitled to on the geo-limited free tier. Must
 * match the model pinned in the adapter's `base3-free-deepseek-flash` agent
 * definition — the backend rejects any other agent/model pairing in free
 * mode.
 */
export const FREEBUFF_FREE_MODEL = "deepseek/deepseek-v4-flash";

/** Per-turn scope carrying the active session's server-assigned instance id. */
interface FreebuffTurnContext {
  readonly instanceId: string;
}

const turnContext = new AsyncLocalStorage<FreebuffTurnContext>();

/**
 * The real network fetch, captured once at module load — before
 * `installFreebuffFetchInterceptor` swaps `globalThis.fetch`. Session
 * admission/release calls use this directly (they are not chat completions,
 * so they never need interception), and the interceptor uses it as its
 * pass-through target. Reading `globalThis.fetch` (rather than the bare
 * `fetch` global) also keeps the Effect `globalFetch` lint satisfied.
 */
const nativeFetch = globalThis.fetch.bind(globalThis);

/** Server response shape for `/api/v1/freebuff/session` (fields we use). */
export interface FreebuffSessionResponse {
  readonly status: string;
  readonly instanceId?: string;
  readonly model?: string;
  readonly accessTier?: string;
  readonly expiresAt?: string;
  readonly remainingMs?: number;
  readonly message?: string;
}

/**
 * Establish (or re-establish) a free session. Mirrors the Freebuff CLI's
 * admission call: POST with the model header and a client-generated instance
 * hint; the server returns the authoritative `instanceId` that subsequent
 * chat completions must carry.
 */
export async function establishFreebuffSession(
  token: string,
  opts: { model?: string; instanceHint?: string; signal?: AbortSignal } = {},
): Promise<FreebuffSessionResponse> {
  const model = opts.model ?? FREEBUFF_FREE_MODEL;
  const instanceHint = opts.instanceHint ?? Crypto.randomUUID();
  const init: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-freebuff-model": model,
      "x-freebuff-instance-id": instanceHint,
    },
    body: "{}",
  };
  if (opts.signal !== undefined) {
    init.signal = opts.signal;
  }
  const response = await nativeFetch(
    `${FREEBUFF_API_BASE}/api/v1/freebuff/session`,
    init,
  );

  // 404 means "no session row" — surface it as a `none` status rather than
  // throwing, so callers can decide.
  if (response.status === 404) {
    return { status: "none" };
  }

  const body = (await response.json().catch(() => null)) as FreebuffSessionResponse | null;
  if (!response.ok) {
    const reason = body?.message ?? body?.status ?? `HTTP ${response.status}`;
    throw new Error(`Freebuff session admission failed: ${reason}`);
  }
  return body ?? { status: "none" };
}

/** Best-effort release of the session slot (DELETE). Never throws. */
export async function releaseFreebuffSession(
  token: string,
  instanceId: string,
): Promise<void> {
  try {
    await nativeFetch(`${FREEBUFF_API_BASE}/api/v1/freebuff/session`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-freebuff-instance-id": instanceId,
      },
    });
  } catch {
    // The server-side sweep is the backstop.
  }
}

let interceptorInstalled = false;

/**
 * Wrap `globalThis.fetch` once so every Freebuff chat-completion request
 * carries the active session's `freebuff_instance_id`. The SDK builds
 * `codebuff_metadata` itself (run_id / client_id / cost_mode) but has no hook
 * for the instance id, so it is merged in here at the transport layer.
 *
 * Strictly a no-op for anything that is not a POST to
 * `/api/v1/chat/completions` running inside a `runWithFreebuffSession` scope,
 * so the rest of the server's fetch traffic is untouched.
 */
export function installFreebuffFetchInterceptor(): void {
  if (interceptorInstalled) return;
  interceptorInstalled = true;

  const intercepted = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const ctx = turnContext.getStore();
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    const isChatCompletion =
      method === "POST" && url.includes("/api/v1/chat/completions");
    if (!ctx || !isChatCompletion || typeof init?.body !== "string") {
      return nativeFetch(input, init);
    }

    try {
      const body = JSON.parse(init.body) as {
        codebuff_metadata?: Record<string, unknown>;
      };
      body.codebuff_metadata = {
        ...(body.codebuff_metadata ?? {}),
        freebuff_instance_id: ctx.instanceId,
      };
      return nativeFetch(input, { ...init, body: JSON.stringify(body) });
    } catch {
      // Unparseable body: pass through untouched rather than breaking the call.
      return nativeFetch(input, init);
    }
  };
  // Bun's `fetch` carries extra props (e.g. `preconnect`); the wrapper only
  // needs the call signature, so assert across the structural gap.
  globalThis.fetch = intercepted as unknown as typeof globalThis.fetch;
}

/**
 * Run `fn` inside a scope that exposes `instanceId` to the fetch interceptor.
 * Every chat-completion request the SDK issues while `fn` is in flight picks
 * up this session's instance id.
 */
export function runWithFreebuffSession<T>(
  instanceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return turnContext.run({ instanceId }, fn);
}
