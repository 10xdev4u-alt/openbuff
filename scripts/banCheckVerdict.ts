/**
 * Verdict classifier for the ban check (#141 follow-up): maps one
 * authenticated GET's response to a verdict without inventing one.
 *
 * The 09-24 receipts: banned came back as 403 with body
 * `{"status":"banned"}` (a diagnostic POST added no reason code), while the
 * web-search API stayed 200 — so the SESSION surface's status+body pair is
 * the signal, and a bare 403 must not be pattern-matched into "banned".
 *
 * @module scripts/banCheckVerdict
 */

export type BanCheckVerdict =
  | "alive"
  | "banned"
  | "token-expired"
  | "unexpected";

export interface BanCheckResult {
  readonly verdict: BanCheckVerdict;
  readonly detail: string;
}

export function classifyBanCheck(status: number, body: string): BanCheckResult {
  if (status === 200) {
    return { verdict: "alive", detail: "session surface reachable — free mode appears restored" };
  }
  if (status === 403 && body.includes('"banned"')) {
    return { verdict: "banned", detail: "terminal per the wire contract — still banned" };
  }
  if (status === 401) {
    return { verdict: "token-expired", detail: "auth token rejected — re-auth before reading anything else into this" };
  }
  return {
    verdict: "unexpected",
    detail: `unplanned response (${status}) — do not act on it; read the body and file what you see`,
  };
}
