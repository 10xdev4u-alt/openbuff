// @effect-diagnostics globalDate:off
// Plain (non-Effect) module: retry-after HTTP-date parsing needs a wall-clock
// "now" for a one-shot header decode. Threading Effect Clock through it for a
// single Date.now() is disproportionate; this matches the sanctioned opt-out
// used by serviceLauncher.ts and usageAggregation.ts.
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
 *   - `establishFreebuffSession` POSTs the dedicated admission route
 *     `/api/v1/freebuff/session/admission` (header-driven, body-less —
 *     identical semantics to the vendor CLI's session API) and returns the
 *     server-assigned `instanceId`.
 *   - `installFreebuffFetchInterceptor` wraps `globalThis.fetch` once. The
 *     SDK resolves `globalThis.fetch` lazily at request time, so the wrapper
 *     sees every chat-completion request and merges `freebuff_instance_id`
 *     into its `codebuff_metadata`. The instance id is read from an
 *     `AsyncLocalStorage` scope so concurrent turns never cross-contaminate.
 *
 * The wire protocol here is ported from the vendor's own published sources
 * (session API + constants), replacing earlier bridge-derived assumptions.
 *
 * @module provider/Services/FreebuffSession
 */
import { AsyncLocalStorage } from "node:async_hooks";

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

/**
 * One per-model quota row from the session response (`rateLimitsByModel`).
 * Minimal projection of upstream `FreebuffSessionRateLimit`: `pool` is an
 * OPAQUE token (group rows by it, never match on values), `poolLabel` is
 * server-authored display copy. Unknown fields pass through untouched.
 */
export interface FreebuffSessionQuotaRow {
  readonly pool?: string;
  readonly poolLabel?: string;
  readonly limit: number;
  readonly recentCount: number;
  readonly resetAt: string;
}

/** Server response shape for `/api/v1/freebuff/session` (fields we use). */
export interface FreebuffSessionResponse {
  readonly status: string;
  readonly instanceId?: string;
  readonly model?: string;
  readonly accessTier?: string;
  readonly expiresAt?: string;
  readonly remainingMs?: number;
  readonly gracePeriodEndsAt?: string;
  readonly gracePeriodRemainingMs?: number;
  readonly message?: string;
  /** Per-model pool status (admission + active poll bodies). */
  readonly rateLimitsByModel?: Record<string, FreebuffSessionQuotaRow>;
  /** Session-window counters (admission + active poll bodies). Week/month are
   *  display-only per upstream docs; `day` is the enforced window. */
  readonly freeWindows?: FreebuffSessionFreeWindows;
  /** Freebucks meter. `null` (vs absent) means the block exists but could not
   *  refresh — consumers must CLEAR stale balances on null. */
  readonly freebucks?: FreebuffSessionFreebucks | null;
}

/** Minimal projection of upstream `FreebuffFreeWindowsInfo`. */
export interface FreebuffSessionFreeWindows {
  readonly dayUsed: number;
  readonly dayLimit: number;
  readonly weekUsed: number;
  readonly weekLimit: number;
  readonly monthUsed: number;
  readonly monthLimit: number;
  readonly dayResetAt: string;
  readonly monthResetAt: string;
}

/** Minimal projection of upstream `FreebuffFreebucksInfo`. */
export interface FreebuffSessionFreebucks {
  readonly quotaExempt?: boolean;
  /** Spendable right now: `daily.remaining + wallet.balance`. */
  readonly balance: number;
  readonly daily: {
    readonly limit: number;
    readonly spent: number;
    readonly remaining: number;
    readonly resetAt: string;
    readonly resetTimeZone?: string;
  };
  readonly wallet: {
    readonly balance: number;
    readonly monthlyBonus: number;
    readonly nextBonusAt?: string;
  };
  readonly planId: string | null;
  /** Session price per model id; only metered models appear. */
  readonly prices: Record<string, number>;
}

/**
 * Dedicated admission route. Fails closed on servers predating these
 * guarantees — we surface that as a reload/update error rather than silently
 * degrading to the legacy session path.
 */
export const FREEBUFF_SESSION_ADMISSION_PATH =
  "/api/v1/freebuff/session/admission";

/** Session poll/release path (GET poll, DELETE release). */
export const FREEBUFF_SESSION_PATH = "/api/v1/freebuff/session";

/** User-facing message when the server does not implement the admission route. */
export const FREEBUFF_SESSION_UNSUPPORTED_MESSAGE =
  "This server cannot safely start or resume your session yet. Reload or update and try again shortly. No purchase was made.";

/** Machine-readable error code for the unsupported-server case. */
export type FreebuffSessionErrorCode =
  | "session_admission_unsupported"
  | string;

/** Typed failure from a hard session-API error (status + code + retry hint). */
export class FreebuffSessionRequestError extends Error {
  readonly status: number;
  readonly errorCode?: string | undefined;
  readonly retryAfterMs?: number | undefined;

  constructor(
    message: string,
    status: number,
    retryAfterMs?: number,
    errorCode?: string,
  ) {
    super(message);
    this.name = "FreebuffSessionRequestError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.errorCode = errorCode;
  }
}

/** `parseRetryAfterMs` equivalent: seconds, or an HTTP date → ms from now. */
function parseRetryAfterMs(
  value: string | null,
  nowMs: number = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    const milliseconds = seconds * 1_000;
    return Number.isFinite(milliseconds) ? Math.ceil(milliseconds) : undefined;
  }
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : undefined;
}

/** IANA timezone header the backend uses for free-window accounting. */
function timeZoneHeaders(): Record<string, string> {
  try {
    return {
      "x-fb-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  } catch {
    return {};
  }
}

/**
 * Establish (or re-establish) a free session on the dedicated admission
 * route. Mirrors the vendor CLI exactly: body-less POST driven entirely by
 * headers — `x-freebuff-model`, `x-freebuff-wallet-spend-limit`,
 * `x-freebuff-first-tab-discount`, timezone, Bearer auth. The instance id
 * header belongs to GET/DELETE only and must NOT be sent on POST.
 *
 * Gate rejections (403/409/429 with typed bodies) are returned as normal
 * responses so callers can classify; only hard errors throw.
 */
export async function establishFreebuffSession(
  token: string,
  opts: {
    model?: string;
    walletSpendLimit?: number;
    firstTabDiscount?: boolean;
    signal?: AbortSignal;
    fetch?: typeof fetch;
  } = {},
): Promise<FreebuffSessionResponse> {
  const doFetch = opts.fetch ?? nativeFetch;
  const model = opts.model ?? FREEBUFF_FREE_MODEL;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...timeZoneHeaders(),
    "x-freebuff-first-tab-discount": opts.firstTabDiscount ? "1" : "0",
    "x-freebuff-model": model,
    "x-freebuff-wallet-spend-limit": String(opts.walletSpendLimit ?? 0),
  };
  const init: RequestInit = { method: "POST", headers };
  if (opts.signal !== undefined) {
    init.signal = opts.signal;
  }
  const response = await doFetch(`${FREEBUFF_API_BASE}${FREEBUFF_SESSION_ADMISSION_PATH}`, init);

  // The dedicated route fails closed: 404/405 means the server predates the
  // guarantees the route exists to provide.
  if (response.status === 404 || response.status === 405) {
    throw new FreebuffSessionRequestError(
      FREEBUFF_SESSION_UNSUPPORTED_MESSAGE,
      response.status,
      undefined,
      "session_admission_unsupported",
    );
  }

  // 403 terminal states (country/ban) and 409/429 gate states arrive as
  // typed bodies — return them for classification instead of throwing.
  const readBody = async (): Promise<FreebuffSessionResponse | null> =>
    (await response.json().catch(() => null)) as FreebuffSessionResponse | null;
  if (response.status === 403) {
    const body = await readBody();
    if (body && (body.status === "country_blocked" || body.status === "banned")) {
      return body;
    }
  }
  if (response.status === 409) {
    const body = await readBody();
    if (
      body &&
      (body.status === "model_locked" ||
        body.status === "model_unavailable" ||
        body.status === "first_tab_discount_changed" ||
        body.status === "consent_required")
    ) {
      return body;
    }
  }
  if (response.status === 429) {
    const body = await readBody();
    if (
      body &&
      (body.status === "rate_limited" ||
        body.status === "spend_limited" ||
        body.status === "ip_capped")
    ) {
      return body;
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let errorCode: string | undefined;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === "string") errorCode = body.error;
    } catch {
      // Non-JSON errors have no machine-readable code.
    }
    throw new FreebuffSessionRequestError(
      `freebuff session POST failed: ${response.status} ${text.slice(0, 200)}`,
      response.status,
      parseRetryAfterMs(response.headers.get("retry-after")),
      errorCode,
    );
  }

  return (await readBody()) ?? { status: "none" };
}

/**
 * Poll the session (GET on the session path) with the compact header —
 * mirrors the vendor CLI: instance id + compact are GET-only headers, 404
 * means the session row is gone (→ `none`), 403 terminal bodies return for
 * classification, hard errors throw typed with retry-after.
 */
export async function pollFreebuffSession(
  token: string,
  instanceId: string,
  opts: { compact?: boolean; signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<FreebuffSessionResponse> {
  const doFetch = opts.fetch ?? nativeFetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "x-freebuff-instance-id": instanceId,
  };
  if (opts.compact !== false) {
    headers["x-freebuff-compact-session"] = "1";
  }
  const init: RequestInit = { method: "GET", headers };
  if (opts.signal !== undefined) {
    init.signal = opts.signal;
  }
  const response = await doFetch(`${FREEBUFF_API_BASE}${FREEBUFF_SESSION_PATH}`, init);

  if (response.status === 404) {
    return { status: "none" };
  }

  const readBody = async (): Promise<FreebuffSessionResponse | null> =>
    (await response.json().catch(() => null)) as FreebuffSessionResponse | null;
  if (response.status === 403) {
    const body = await readBody();
    if (body && (body.status === "country_blocked" || body.status === "banned")) {
      return body;
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let errorCode: string | undefined;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === "string") errorCode = body.error;
    } catch {
      // Non-JSON errors have no machine-readable code.
    }
    throw new FreebuffSessionRequestError(
      `freebuff session GET failed: ${response.status} ${text.slice(0, 200)}`,
      response.status,
      parseRetryAfterMs(response.headers.get("retry-after")),
      errorCode,
    );
  }

  return (await readBody()) ?? { status: "none" };
}

/**
 * Classification of one session poll, per the vendor's documented grace
 * semantics: `ended` WITH `instanceId` = server-side grace window (chat
 * finishes, no new prompts); `ended` WITHOUT = fully gone, rejoin via the
 * admission POST.
 */
export type SessionPollClass =
  | { readonly kind: "active"; readonly instanceId: string }
  | {
      readonly kind: "grace";
      readonly instanceId: string;
      readonly graceEndsAt?: string | undefined;
      readonly graceRemainingMs?: number | undefined;
    }
  | { readonly kind: "gone" }
  | { readonly kind: "superseded" }
  | { readonly kind: "blocked"; readonly status: string }
  | { readonly kind: "unknown"; readonly status: string };

/**
 * Pure classifier over a poll response — no I/O, fake-clock testable, and
 * unknown statuses never escalate to a fatal class (a weird poll must never
 * kill a live session; the 429 lesson).
 */
export function classifySessionPoll(res: FreebuffSessionResponse): SessionPollClass {
  switch (res.status) {
    case "active":
      return res.instanceId !== undefined
        ? { kind: "active", instanceId: res.instanceId }
        : { kind: "unknown", status: res.status };
    case "ended":
      return res.instanceId !== undefined
        ? {
            kind: "grace",
            instanceId: res.instanceId,
            graceEndsAt: res.gracePeriodEndsAt,
            graceRemainingMs: res.gracePeriodRemainingMs,
          }
        : { kind: "gone" };
    case "none":
      return { kind: "gone" };
    case "superseded":
      return { kind: "superseded" };
    case "banned":
    case "country_blocked":
      return { kind: "blocked", status: res.status };
    default:
      return { kind: "unknown", status: res.status };
  }
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
