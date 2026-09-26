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
    // Reviewers do not spawn reviewers: no recursion surface, and any
    // spawnable it names would dangle (reviewers are not suites). The SDK
    // normalizes the absent field to an empty array; both shapes are safe.
    expect(def.spawnableAgents ?? []).toEqual([]);
    expect(def.outputMode).toBe("last_message");
    expect(def.includeMessageHistory).toBe(true);
    expect(def.instructionsPrompt).toMatch(/critical/i);
    // The reviewer suggests, never edits: it must promise zero tool use.
    expect(def.instructionsPrompt).toMatch(/do not (use|call) (any )?tools/i);
  });

  it("keeps drain-row picks on their own root and model (no coercion)", () => {
    // #143, restated 2026-09-26: upstream keeps picker-retired rows ADMISSIBLE
    // while their draining sessions run (solar-pro4, picker-retired
    // 09-23→09-25). A pick of a drain row must resolve to its own pairing on
    // both fields — coercing either one would switch the model under an
    // already-admitted session. gpt-5.6-luna left this class on 2026-09-24
    // (upstream PAUSED it; picks now coerce).
    for (const [model, rootId] of [
      ["upstage/solar-pro4", "base3-free-solar-pro4"],
    ] as const) {
      const { root, agentDefinitions } = makeFreebuffAgentSuite(model);
      expect(root.id).toBe(rootId);
      expect(root.model).toBe(model);
      const reviewer = agentDefinitions.find((def) => def.id === FREEBUFF_REVIEWER_AGENT_ID);
      expect(reviewer?.model).toBe(model);
    }
  });

  it("coerces unknown or withdrawn picks to the default on BOTH fields together", () => {
    // #1801 doctrine at the adapter layer: a model outside the pairing map
    // must move root id AND root.model to the tier default in the same
    // breath. A mixed state (default root carrying a foreign model) is
    // exactly what the session gate rejects with `session_model_mismatch`.
    for (const dead of [
      "stealth/ox-alpha",
      "minimax/minimax-m3",
      "deepseek/deepseek-v4-pro",
      "z-ai/glm-5.2",
      "meta/muse-spark-1.3-contributor",
      "acme/nonexistent",
    ]) {
      const { root, agentDefinitions } = makeFreebuffAgentSuite(dead);
      expect(root.id, `root id for ${dead}`).toBe("base3-free-glm-5-3-flash");
      expect(root.model, `root model for ${dead}`).toBe(DEFAULT_FREEBUFF_FREE_MODEL);
      const reviewer = agentDefinitions.find((def) => def.id === FREEBUFF_REVIEWER_AGENT_ID);
      expect(reviewer?.model, `reviewer model for ${dead}`).toBe(DEFAULT_FREEBUFF_FREE_MODEL);
    }
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
    // GLM 5.3 Flash is the tier default (#137): upstream moved it 2026-08-30.
    expect(FREEBUFF_FREE_AGENT_BY_MODEL[DEFAULT_FREEBUFF_FREE_MODEL]).toBe(
      "base3-free-glm-5-3-flash",
    );
  });

  it("is accepted by the SDK's own runtime validation", async () => {
    // generateInitialRunState zod-parses the definitions exactly as a real
    // run would — acceptance here is runtime proof without a live session.
    // Proven for the three suite shapes a session can produce: the default,
    // a drain-row pick (#143), and an unknown model coerced to the default.
    const { generateInitialRunState } = await import("@codebuff/sdk");
    for (const model of [undefined, "upstage/solar-pro4", "acme/nonexistent"]) {
      const { root, agentDefinitions } = makeFreebuffAgentSuite(model);
      expect(() =>
        generateInitialRunState({
          cwd: NodeFS.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "ob-suite-probe-")),
          agentDefinitions: [root, ...agentDefinitions],
          fs: NodeFSP,
        }),
      ).not.toThrow();
    }
  });

  it("instructs the root to spawn the reviewer after significant changes", () => {
    const { root } = makeFreebuffAgentSuite(undefined);
    expect(root.systemPrompt).toMatch(/review/i);
    expect(root.systemPrompt).toMatch(/significant/i);
  });
});
