// @effect-diagnostics nodeBuiltinImport:off - SDK runtime-acceptance probe needs real fs/path.
import type { AgentDefinition } from "@codebuff/sdk";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { FREEBUFF_REVIEWER_AGENT_ID, makeFreebuffAgentSuite } from "./FreebuffAdapter.js";
import { DEFAULT_FREEBUFF_FREE_MODEL, FREEBUFF_FREE_AGENT_BY_MODEL } from "@t3tools/contracts";

/**
 * Wire contract for the OpenBuff subagent suite (#108).
 *
 * Upstream Freebuff gates subagents (and code review) behind base2-tier
 * roots; free base3 sessions get neither (#107 research). Our root template
 * is local (no DB fetch), so the suite must self-contain every agent it
 * names: a `spawnableAgents` entry that is not registered as a local
 * template falls through to the publisher database, which 404s for free
 * agents and hangs the run forever.
 *
 * The same-model rule is load-bearing: the chat-completions session gate
 * rejects any request whose model differs from the admitted session's
 * (`session_model_mismatch`), so a reviewer on any other model dies
 * mid-run — silently, exactly how upstream Fable lost code review.
 */
describe("freebuff subagent suite (#108)", () => {
  it("arms the root with spawn tooling and the reviewer spawnable", () => {
    const { root, agentDefinitions } = makeFreebuffAgentSuite(undefined);
    expect(root.toolNames).toContain("spawn_agents");
    // `set_output` is for spawned agents reporting home, not for roots.
    expect(root.toolNames).not.toContain("set_output");
    expect(root.spawnableAgents).toContain(FREEBUFF_REVIEWER_AGENT_ID);
    // Every spawnable must resolve locally: no dangling publisher fetches.
    for (const spawnable of root.spawnableAgents ?? []) {
      expect(
        agentDefinitions.some((def) => def.id === spawnable),
        `spawnable "${spawnable}" must be registered as a local template`,
      ).toBe(true);
    }
  });

  it("builds a tool-less reviewer that reports via last_message", () => {
    const { agentDefinitions } = makeFreebuffAgentSuite(undefined);
    const reviewer = agentDefinitions.find((def) => def.id === FREEBUFF_REVIEWER_AGENT_ID);
    expect(reviewer).toBeDefined();
    const def = reviewer as AgentDefinition;
    expect(def.toolNames).toEqual([]);
    expect(def.outputMode).toBe("last_message");
    expect(def.includeMessageHistory).toBe(true);
    expect(def.instructionsPrompt).toMatch(/critical/i);
    // The reviewer suggests, never edits: it must promise zero tool use.
    expect(def.instructionsPrompt).toMatch(/do not (use|call) (any )?tools/i);
  });

  it("keeps reviewer and root on the SAME model for every free pairing", () => {
    // The Fable trap: one missing/foreign-model entry silently loses review.
    const models = [...Object.keys(FREEBUFF_FREE_AGENT_BY_MODEL), undefined];
    for (const model of models) {
      const { root, agentDefinitions } = makeFreebuffAgentSuite(model);
      const reviewer = agentDefinitions.find((def) => def.id === FREEBUFF_REVIEWER_AGENT_ID);
      expect(reviewer, `reviewer missing for model ${model}`).toBeDefined();
      expect(reviewer?.model).toBe(root.model);
    }
    expect(FREEBUFF_FREE_AGENT_BY_MODEL[DEFAULT_FREEBUFF_FREE_MODEL]).toBe(
      "base3-free-deepseek-flash",
    );
  });

  it("is accepted by the SDK's own runtime validation", async () => {
    // generateInitialRunState zod-parses the definitions exactly as a real
    // run would — acceptance here is runtime proof without a live session.
    const { generateInitialRunState } = await import("@codebuff/sdk");
    const { root, agentDefinitions } = makeFreebuffAgentSuite(undefined);
    expect(() =>
      generateInitialRunState({
        cwd: NodeFS.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "ob-suite-probe-")),
        agentDefinitions: [root, ...agentDefinitions],
        fs: NodeFSP,
      }),
    ).not.toThrow();
  });

  it("instructs the root to spawn the reviewer after significant changes", () => {
    const { root } = makeFreebuffAgentSuite(undefined);
    expect(root.systemPrompt).toMatch(/review/i);
    expect(root.systemPrompt).toMatch(/significant/i);
  });
});
