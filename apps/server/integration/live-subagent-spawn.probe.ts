// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalFetch:off - live probe runs as a plain node script, not an Effect program.
/**
 * LIVE SUBAGENT SPAWN PROBE (the unproven claim behind #108/#109).
 *
 * Establishes a REAL free session, runs the production agent suite
 * (makeFreebuffAgentSuite) through the real SDK against the real backend
 * with a prompt that forces a significant change, and taps the event stream
 * for `subagent_start` / `subagent_finish` — wire proof that a free-tier
 * root can spawn the same-model code-reviewer in production.
 *
 * The turn runs INSIDE the session scope (runWithFreebuffSession) so every
 * chat-completion request carries `freebuff_instance_id` — without it the
 * backend answers `waiting_room_required`. Admission opts OUT of the
 * first-tab discount on the first-ever admission per the sticky design.
 *
 * Cleanup is in finally: the seat is released no matter how the run ends.
 *
 * Run from apps/server: node --experimental-strip-types \
 *   integration/live-subagent-spawn.probe.ts
 * (tsx also works: npx tsx integration/live-subagent-spawn.probe.ts)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  establishFreebuffSession,
  installFreebuffFetchInterceptor,
  releaseFreebuffSession,
  runWithFreebuffSession,
} from "../src/provider/Services/FreebuffSession.js";
import { makeFreebuffAgentSuite } from "../src/provider/Services/FreebuffAdapter.js";
import { DEFAULT_FREEBUFF_FREE_MODEL } from "@t3tools/contracts";

const credPath = path.join(os.homedir(), ".config/manicode/credentials.json");
const parsedCreds: unknown = JSON.parse(fs.readFileSync(credPath, "utf8"));
const creds =
  typeof parsedCreds === "object" && parsedCreds !== null
    ? (parsedCreds as { default?: { authToken?: string; email?: string } })
    : undefined;
const token = creds?.default?.authToken;
if (!token) {
  console.error("no authToken in", credPath);
  process.exit(1);
}
console.log("identity:", creds?.default?.email ?? "unknown");

// Model under test: argv[2] overrides the tier default. Discriminates
// "lane outage" from "probe path broken" — a lane that 503s while another
// admits and completes exonerates the probe.
const PROBE_MODEL = process.argv[2] ?? DEFAULT_FREEBUFF_FREE_MODEL;

// ── 1. Admit a real session on the model under test ────────────────────────
const admission = await establishFreebuffSession(token, {
  firstTabDiscount: false,
  model: PROBE_MODEL,
});
if (admission.status !== "active" || !admission.instanceId) {
  console.error("admission did not go active:", admission.status);
  process.exit(1);
}
const instanceId = admission.instanceId;
console.log("── admission ──");
console.log("status: active | instanceId:", instanceId);
console.log("model:", PROBE_MODEL);

const { CodebuffClient } = await import("@codebuff/sdk");

try {
  // ── 2. Real turn inside the session scope, event stream tapped ──────────
  // The interceptor wraps globalThis.fetch so every chat-completion request
  // carries `freebuff_instance_id` in codebuff_metadata. Without it the
  // backend answers `waiting_room_required` (observed live 2026-09-24 UTC).
  installFreebuffFetchInterceptor();
  const events: Array<{ type: string; agentType?: string; agentId?: string; displayName?: string }> =
    [];
  let assistantChunks = 0;

  await runWithFreebuffSession(instanceId, async () => {
    const suite = makeFreebuffAgentSuite(PROBE_MODEL);
    const client = new CodebuffClient({
      apiKey: token,
      logger: {
        debug: () => {},
        info: () => {},
        warn: (...args: unknown[]) =>
          process.stderr.write(`[probe-sdk:warn] ${args.map(String).join(" ")}\n`),
        error: (...args: unknown[]) =>
          process.stderr.write(`[probe-sdk:error] ${args.map(String).join(" ")}\n`),
      },
    } as never);

    const runState = await client.run({
      agent: suite.root,
      agentDefinitions: suite.agentDefinitions,
      costMode: "free",
      prompt:
        "Create the file probe-target.ts in the current directory containing a function " +
        "add(a: number, b: number): number that returns a + b, then STOP. This is a " +
        "probe artifact; keep it minimal.",
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), "ob-spawn-probe-")),
      maxAgentSteps: 15,
      handleEvent: (event: unknown) => {
        const e = event as { type: string; agentType?: string; agentId?: string; displayName?: string };
        if (e.type === "subagent_start" || e.type === "subagent_finish") {
          events.push(e);
          console.log(`[event] ${e.type}: ${e.agentType ?? "?"} (${e.displayName ?? "?"})`);
        }
        if (e.type === "assistant_message") assistantChunks += 1;
      },
    });

    console.log("── run ──");
    const output = (runState as { output?: unknown }).output;
    console.log(
      "assistant messages:",
      assistantChunks,
      "| output:",
      typeof output === "string" ? output.slice(0, 200) : JSON.stringify(output)?.slice(0, 200),
    );
  });

  // ── 3. The verdict ──────────────────────────────────────────────────────
  const starts = events.filter((e) => e.type === "subagent_start");
  const finishes = events.filter((e) => e.type === "subagent_finish");
  const reviewerStarts = starts.filter((e) => (e.agentType ?? "").includes("code-reviewer"));
  console.log("── verdict ──");
  console.log("subagent_start events:", starts.length);
  console.log("subagent_finish events:", finishes.length);
  console.log("code-reviewer spawns:", reviewerStarts.length);
  if (reviewerStarts.length > 0 && finishes.length > 0) {
    console.log("LIVE SPAWN PROVEN: the free-tier root spawned and drained the reviewer.");
  } else if (starts.length > 0) {
    console.log("PARTIAL: subagents spawned but none finished — inspect the event log above.");
  } else {
    console.log("NO SPAWN OBSERVED: the root completed its turn without delegating.");
  }
} finally {
  // ── 4. Seat released no matter what ──────────────────────────────────────
  await releaseFreebuffSession(token, instanceId);
  console.log("── released (DELETE) ──");
}
