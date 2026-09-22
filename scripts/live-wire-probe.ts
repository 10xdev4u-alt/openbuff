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
const creds = JSON.parse(fs.readFileSync(credPath, "utf8")) as {
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
// (observed live 2026-09-23), which validates the gate exactly.
const admission = await establishFreebuffSession(token, { firstTabDiscount: false });
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
  const poll = await pollFreebuffSession(token, admission.instanceId);
  console.log("── poll ──");
  console.log(
    "status:",
    poll.status,
    "| rateLimit rows:",
    Object.keys(poll.rateLimitsByModel ?? {}).length,
  );
  await releaseFreebuffSession(token, admission.instanceId);
  console.log("── released (DELETE) ──");
}
