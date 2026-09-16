/**
 * FreebuffGate — session gate classifier for free-mode rejections.
 *
 * Port of the upstream wire contract: a gate rejection is identified ONLY by
 * the (`error` code, HTTP status) pair — status-only or code-only matching
 * lets an unrelated upstream error impersonate the gate. Own-property lookup
 * (not `in`) so inherited names like `toString` can't classify.
 *
 * Recovery dispositions mirror the reference client's policy:
 *   - Seat-ending codes (`ended`): the session is gone; finalize the turn and
 *     let the user's next message re-admit. Never auto-retry admissions.
 *   - `superseded`: another client took the seat — terminal, never fought.
 *   - Transient / account-limited / model-closed: the session survives; the
 *     message explains what happened.
 *
 * @module provider/Services/FreebuffGate
 */

/** Gate rejection table: `error` code → its HTTP status half. */
export const FREEBUFF_GATE_CODES = {
  waiting_room_required: { status: 428, endsTheSession: true },
  session_expired: { status: 410, endsTheSession: true },
  session_superseded: { status: 409, endsTheSession: true },
  session_model_mismatch: { status: 409, endsTheSession: true },
  /** The ACCOUNT is over its concurrent-session budget; this row is fine. */
  session_limit_reached: { status: 409, endsTheSession: false },
  /** Transient admission race — the row was caught mid-admit. */
  waiting_room_queued: { status: 429, endsTheSession: false },
  /** The model is closed/withdrawn from free mode. Terminal for the request,
   *  not the session. */
  model_unavailable: { status: 410, endsTheSession: false },
} as const satisfies Record<string, { status: number; endsTheSession: boolean }>;

export type FreebuffGateCode = keyof typeof FREEBUFF_GATE_CODES;

/**
 * The gate rejection this error output describes, or null for anything else.
 * Accepts any thrown value; only objects carrying the exact (code, status)
 * pair classify.
 */
export function classifyFreebuffGate(
  output: unknown,
): FreebuffGateCode | null {
  if (typeof output !== "object" || output === null) return null;
  const { error: code, statusCode } = output as {
    error?: unknown;
    statusCode?: unknown;
  };
  if (typeof code !== "string") return null;
  if (!Object.hasOwn(FREEBUFF_GATE_CODES, code)) return null;
  const gate = FREEBUFF_GATE_CODES[code as FreebuffGateCode];
  return gate.status === statusCode ? (code as FreebuffGateCode) : null;
}

/** What happens to the local session after this gate code. */
export type FreebuffGateDisposition =
  | "ended"
  | "superseded"
  | "retry-transient"
  | "account-limited"
  | "model-closed";

const GATE_DISPOSITIONS: Record<FreebuffGateCode, FreebuffGateDisposition> = {
  waiting_room_required: "ended",
  session_expired: "ended",
  session_model_mismatch: "ended",
  session_superseded: "superseded",
  waiting_room_queued: "retry-transient",
  session_limit_reached: "account-limited",
  model_unavailable: "model-closed",
};

export function freebuffGateDisposition(
  code: FreebuffGateCode,
): FreebuffGateDisposition {
  return GATE_DISPOSITIONS[code];
}

/**
 * Actionable user-facing message per gate code (ported from the reference
 * client's copy, adapted to the web surface). Returns undefined for
 * non-gate failures so raw error text flows unchanged.
 */
export function gateUserMessage(code: FreebuffGateCode | null): string | undefined {
  switch (code) {
    case "waiting_room_required":
    case "session_expired":
    case "session_model_mismatch":
      return "Your free session ended before this message was processed. Start a new session and send it again.";
    case "session_superseded":
      return "Another OpenBuff session took over this account. Close the other session, then reload here.";
    case "waiting_room_queued":
      return "Your free session is still being set up. Try again in a moment.";
    case "session_limit_reached":
      return "This account already holds the maximum number of active sessions.";
    case "model_unavailable":
      return "That model isn't available in free mode right now. Pick another model and try again.";
    default:
      return undefined;
  }
}
