// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - probe runs as a plain node script, not an Effect program.
/**
 * Live wire probe (follow-up to #107/#109, self-contained since #139):
 * establish a REAL Freebuff free session with the local CLI credentials and
 * print what the wire actually returns — proof of the disciplines the
 * adapter tests assert against doubles: header echo, quote shape, opt-in
 * state. One POST, one GET, then a DELETE of the seat it created (read-only
 * on the account otherwise).
 *
 * Wire shapes are inlined here rather than imported from apps/server: the
 * scripts project must not reach into app sources (cross-project TS6307),
 * and the probe must stay runnable against a server that predates any
 * constant's current value. The canonical constants live in
 * apps/server/src/provider/Services/FreebuffSession.ts — change both.
 *
 * Run from repo root: node --experimental-strip-types scripts/live-wire-probe.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const BASE = "https://www.codebuff.com";
const ADMISSION_PATH = `${BASE}/api/v1/freebuff/session/admission`;
const SESSION_PATH = `${BASE}/api/v1/freebuff/session`;
/** Mirrors FREEBUFF_FREE_MODEL (the tier default). */
const PROBE_MODEL = "z-ai/glm-5.3-flash";

const credPath = path.join(os.homedir(), ".config/manicode/credentials.json");
const parsedCreds: unknown = JSON.parse(fs.readFileSync(credPath, "utf8"));
if (typeof parsedCreds !== "object" || parsedCreds === null) {
  console.error("malformed credentials file:", credPath);
  process.exit(1);
}
const creds = parsedCreds as {
  default?: { authToken?: string; email?: string };
};
const token = creds.default?.authToken;
if (!token) {
  console.error("no authToken in", credPath);
  process.exit(1);
}
console.log("identity:", creds.default?.email ?? "unknown");

interface ProbeAdmission {
  status: string;
  instanceId?: string;
  freebucks?: {
    balance?: number;
    prices?: Record<string, number>;
    listPrices?: unknown;
    firstTabDiscount?: unknown;
    offPeak?: Record<string, unknown>;
    priceChanges?: unknown[];
    priceNotices?: Record<string, unknown>;
  };
}

const post = async (): Promise<ProbeAdmission> => {
  const response = await globalThis.fetch(ADMISSION_PATH, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-fb-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
      // Sticky discipline (the design the adapter implements): the FIRST-ever
      // admission opts OUT — nothing has been offered yet. Forcing the opt-in
      // without a prior quote earns `first_tab_discount_changed` from the
      // server (observed live 2026-09-22 UTC), which validates the gate.
      "x-freebuff-first-tab-discount": "0",
      "x-freebuff-model": PROBE_MODEL,
      "x-freebuff-wallet-spend-limit": "0",
    },
    // Upstream POSTs are body-less — no JSON, no Content-Type.
  });
  return (await response.json()) as ProbeAdmission;
};

const admission = await post();

// Note: the live capture this probe printed on 2026-09-22 UTC (see issue
// #137 and the graph row) is the evidence record; dates in those records
// are execution dates in UTC.
console.log("── admission ──");
console.log("status:", admission.status);
console.log("instanceId:", admission.instanceId);
const fb = admission.freebucks;
if (fb && typeof fb === "object") {
  console.log("balance:", fb.balance);
  console.log("prices:", JSON.stringify(fb.prices));
  console.log("listPrices:", JSON.stringify(fb.listPrices ?? null));
  console.log("firstTabDiscount:", JSON.stringify(fb.firstTabDiscount ?? null));
  console.log("offPeak models:", Object.keys(fb.offPeak ?? {}).length);
  console.log("priceChanges:", (fb.priceChanges ?? []).length);
  console.log("priceNotices models:", Object.keys(fb.priceNotices ?? {}).length);
} else {
  console.log("freebucks:", admission.freebucks);
}

if (admission.status === "active" && admission.instanceId) {
  const instanceId = admission.instanceId;
  try {
    const response = await globalThis.fetch(SESSION_PATH, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-freebuff-instance-id": instanceId,
        "x-freebuff-compact-session": "1",
      },
    });
    const poll = (await response.json()) as ProbeAdmission;
    console.log("── poll ──");
    console.log(
      "status:",
      poll.status,
      "| rateLimit rows:",
      Object.keys((poll as { rateLimitsByModel?: Record<string, unknown> }).rateLimitsByModel ?? {})
        .length,
    );
  } finally {
    // Release in finally: a poll failure must never leak the seat.
    await globalThis.fetch(SESSION_PATH, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-freebuff-instance-id": instanceId,
      },
    });
    console.log("── released (DELETE) ──");
  }
}
