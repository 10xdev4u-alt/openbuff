// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalFetch:off globalDate:off - probe runs as a plain node script, not an Effect program.
/**
 * Ban check (#141 follow-up): ONE authenticated GET against the free-session
 * surface, verdict printed, exit code set. Deliberately NOT an admission.
 *
 * The 09-24 receipts say this is safe: after the ban, a diagnostic POST got
 * the terminal 403, but authenticated non-session APIs answered 200 — the
 * account was alive, only free mode was gated. A single session-surface GET
 * is the same class of read; it holds no seat and starts no turn.
 *
 * Modes (see scripts/probeEtiquette.ts):
 *   (default)  passive — one GET, runs any time, no etiquette gating.
 *   --active   attempt an actual ADMISSION (the real "can I get a seat?"
 *              answer). Vetoed by the etiquette guard: one per hour max,
 *              never 02:00-05:00 UTC, no retry ladder, first 503 wall is
 *              STOP. Requires --i-understand-the-etiquette.
 *
 * Run from repo root:
 *   node --experimental-strip-types scripts/ban-check.ts
 *   node --experimental-strip-types scripts/ban-check.ts --active --i-understand-the-etiquette
 *
 * Exit codes: 0 = alive, 1 = banned, 2 = inconclusive (unexpected/expired),
 *             3 = refused by the etiquette guard.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  enforceProbeEtiquette,
  type EtiquetteVerdict,
} from "./probeEtiquette.ts";
import { classifyBanCheck } from "./banCheckVerdict.ts";

const BASE = "https://www.codebuff.com";
const SESSION_PATH = `${BASE}/api/v1/freebuff/session`;

const args = new Set(process.argv.slice(2));
const mode = args.has("--active") ? "active" : "passive";
const lastAdmissionRaw = process.env.OPENBUFF_LAST_ADMISSION_MS;
const lastAdmissionAt = lastAdmissionRaw ? Number(lastAdmissionRaw) : undefined;

function refuse(verdict: EtiquetteVerdict): never {
  console.error(`ETIQUETTE REFUSAL: ${verdict.reason}`);
  if (verdict.retryAtMs !== undefined) {
    console.error(`  next allowed window opens: ${new Date(verdict.retryAtMs).toISOString()}`);
  }
  process.exit(3);
}

const verdict = enforceProbeEtiquette({ now: Date.now(), lastAdmissionAt, mode });
if (!verdict.allowed) refuse(verdict);
if (mode === "active" && !args.has("--i-understand-the-etiquette")) {
  console.error(
    "ETIQUETTE REFUSAL: --active requires --i-understand-the-etiquette — one admission,\n" +
      "no retries, STOP on the first 503 wall. Read docs/operations/probe-resumption.md first.",
  );
  process.exit(3);
}

const credPath = path.join(os.homedir(), ".config/manicode/credentials.json");
const parsedCreds: unknown = JSON.parse(fs.readFileSync(credPath, "utf8"));
const token = (parsedCreds as { default?: { authToken?: string } }).default?.authToken;
if (!token) {
  console.error("no authToken in", credPath);
  process.exit(2);
}

const response = await fetch(SESSION_PATH, {
  method: "GET",
  headers: { Authorization: `Bearer ${token}` },
});
const body = await response.text();
const result = classifyBanCheck(response.status, body);

console.log(`GET ${SESSION_PATH}`);
console.log(`  status: ${response.status}`);
console.log(`  body:   ${body.slice(0, 200)}`);
console.log(`  verdict: ${result.verdict} — ${result.detail}`);
if (mode === "active" && result.verdict === "alive") {
  console.log(
    "  NOTE: the surface is reachable; an admission under the etiquette budget\n" +
      "  (this script's --active) is the only proof a seat is actually granted.",
  );
}

switch (result.verdict) {
  case "alive":
    process.exit(0);
  case "banned":
    process.exit(1);
  default:
    process.exit(2);
}
