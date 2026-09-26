/**
 * Probe-etiquette guard (#141): the runbook's rules as code, so "one more
 * run, it'll work this time" is not a decision a 2am operator gets to make.
 *
 * The ban trigger was admission CHURN — six admissions in ~35 minutes, each
 * released with zero completed turns, during US-evening peak. This module
 * encodes the two rules that prevent that shape:
 *
 *  1. SPACING — at most one admission per hour (the "1 hour" is the gap
 *     between admissions, not a session length; a session is a seat held
 *     for a turn and released).
 *  2. WINDOW — active admissions never during the US-evening peak
 *     (02:00–05:00 UTC per docs/operations/probe-resumption.md); early UTC
 *     morning is the calmest observed period.
 *
 * The PASSIVE mode (one authenticated GET, no seat) is deliberately exempt
 * from both rules: the 09-26 02:50 web-search 200 proved the account stays
 * reachable while banned, and a ban checker that sleeps through the only
 * window an operator checks at 2am is useless.
 *
 * @module scripts/probeEtiquette
 */

/** Minimum gap between active admissions: 1 hour. */
export const PROBE_SPACING_MS = 60 * 60 * 1000;

/** US-evening peak, UTC hours [start, end). The pool's most loaded window. */
export const PROBE_PEAK_WINDOW_UTC = { startHour: 2, endHour: 5 } as const;

export type ProbeMode = "passive" | "active";

export interface EtiquetteVerdict {
  readonly allowed: boolean;
  /** Human-readable refusal reason; present only when not allowed. */
  readonly reason?: string;
  /** Epoch ms when this probe may next run, if a spacing refusal said no. */
  readonly retryAtMs?: number;
}

export function enforceProbeEtiquette(input: {
  readonly now: number;
  readonly lastAdmissionAt: number | undefined;
  readonly mode: ProbeMode;
}): EtiquetteVerdict {
  if (input.mode === "passive") {
    return { allowed: true };
  }
  // UTC hour of the epoch-ms instant, without constructing a Date: the Unix
  // epoch starts at midnight UTC, so whole hours since epoch mod 24 IS the
  // UTC hour. (The scripts package bans raw Date construction — time flows
  // in as numbers here, and the caller's clock owns the reading.)
  const hour = Math.floor(input.now / 3_600_000) % 24;
  if (hour >= PROBE_PEAK_WINDOW_UTC.startHour && hour < PROBE_PEAK_WINDOW_UTC.endHour) {
    return {
      allowed: false,
      reason: `peak window (02:00-05:00 UTC): the pool's most loaded hours — the 09-24 ban fired here`,
    };
  }
  if (
    input.lastAdmissionAt !== undefined &&
    input.now - input.lastAdmissionAt < PROBE_SPACING_MS
  ) {
    const retryAtMs = input.lastAdmissionAt + PROBE_SPACING_MS;
    return {
      allowed: false,
      reason: `spacing: an admission ran ${Math.round((input.now - input.lastAdmissionAt) / 60000)} min ago (minimum gap 60 min)`,
      retryAtMs,
    };
  }
  return { allowed: true };
}
