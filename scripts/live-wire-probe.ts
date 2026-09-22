/**
 * Live wire probe (follow-up to #107/#109): establish a REAL Freebuff free
 * session with the local CLI credentials and print what the wire actually
 * returns — proof of the disciplines the adapter tests assert against
 * doubles: header echo, quote shape, opt-in state. One POST, one GET, then
 * a DELETE of the seat it created (read-only on the account otherwise).
 *
 * Run from repo root: node --experimental-strip-types scripts/live-wire-probe.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  establishFreebuffSession,
  pollFreebuffSession,
  releaseFreebuffSession,
} from "../apps/server/src/provider/Services/FreebuffSession.ts";

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

// Sticky discipline (the design the adapter implements): the FIRST-ever
// admission opts OUT — nothing has been offered yet. Forcing the opt-in
// without a prior quote earns `first_tab_discount_changed` from the server
// (observed live 2026-09-22 UTC), which validates the gate exactly.
const admission = await establishFreebuffSession(token, { firstTabDiscount: false });
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
    const poll = await pollFreebuffSession(token, instanceId);
    console.log("── poll ──");
    console.log(
      "status:",
      poll.status,
      "| rateLimit rows:",
      Object.keys(poll.rateLimitsByModel ?? {}).length,
    );
  } finally {
    // Release in finally: a poll failure must never leak the seat.
    await releaseFreebuffSession(token, instanceId);
    console.log("── released (DELETE) ──");
  }
}
