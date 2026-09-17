/**
 * FreebuffAdapter — `ProviderAdapterShape` over `@codebuff/sdk`.
 *
 * One in-process `CodebuffClient` run per turn. The SDK executes the whole
 * agent loop (its own tools, its own model routing through the Codebuff
 * backend) and reports progress through two callbacks; this adapter's job
 * is purely transliteration:
 *
 *   SDK                              → canonical ProviderRuntimeEvent
 *   ─────────────────────────────────────────────────────────────────
 *   handleStreamChunk (string)       → content.delta { assistant_text }
 *   handleStreamChunk reasoning      → content.delta { reasoning_text }
 *   handleEvent tool_call            → item.started
 *   handleEvent tool_result          → item.completed
 *   run() resolves (RunState)        → turn.completed { completed }
 *   AbortSignal fires                → turn.aborted
 *   run() rejects                    → turn.completed { failed, errorMessage }
 *
 * Session continuity: the SDK's returned `RunState` is stored per thread
 * and passed as `previousRun` on the next turn — that is the entire resume
 * story. `readThread` reconstructs a minimal snapshot from the accumulated
 * turns; `rollbackThread` is a documented no-op for v1 (the SDK has no
 * conversation rewind; checkpoint-revert at the orchestration layer is the
 * real path — see issue #8).
 *
 * `respondToRequest` / `respondToUserInput` validate the session but cannot
 * yet reach into a running SDK turn; interactive approvals arrive with the
 * `overrideTools` interception in issue #4.
 *
 * @module provider/Services/FreebuffAdapter
 */
import {
  CodebuffClient,
  ToolHelpers,
  type AgentDefinition,
  type ClientToolCall,
  type CodebuffToolOutput,
  type PrintModeEvent,
  type RunState,
} from "@codebuff/sdk";
import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import {
  DEFAULT_FREEBUFF_FREE_MODEL,
  FREEBUFF_FREE_AGENT_BY_MODEL,
  resolveFreebuffAgentForModel,
} from "@t3tools/contracts";
import {
  classifyFreebuffGate,
  freebuffGateDisposition,
  gateUserMessage,
} from "./FreebuffGate.ts";
import {
  mergeProviderUsage,
  usageFromSessionResponse,
} from "../providerUsageMerge.ts";
import type { FreebuffProviderUsage } from "@t3tools/contracts";
import type {
  ProviderAdapterShape,
  ProviderThreadSnapshot,
} from "./ProviderAdapter.ts";
import type { FreebuffSettings } from "@t3tools/contracts";
import {
  classifySessionPoll,
  establishFreebuffSession,
  formatModelUnavailableProse,
  installFreebuffFetchInterceptor,
  pollFreebuffSession,
  releaseFreebuffSession,
  runWithFreebuffSession,
} from "./FreebuffSession.ts";

export const FREEBUFF_DRIVER_KIND = ProviderDriverKind.make("freebuff");

export interface MakeFreebuffAdapterOptions {
  readonly config: FreebuffSettings;
  readonly instanceId: string;
  /**
   * Mutable box the adapter writes each session response's usage meter into
   * (issue #31). The driver's snapshot closure reads it on getSnapshot/refresh
   * so the web cockpit sees the freshest capture without a new RPC. Optional:
   * absent (tests, non-snapshot embeddings) simply skips the capture.
   */
  readonly usageRef?: { current: FreebuffProviderUsage | undefined };
  /**
   * Transport override for the session REST calls (admission GET/POST, polls,
   * DELETE release). Mirrors `FreebuffSession.ts`'s `opts.fetch` convention so
   * tests can inject doubles instead of hitting the network. Optional: absent
   * means the module-bound native fetch (production default).
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * SDK client seam. Optional: absent constructs a real `CodebuffClient`;
   * tests inject a stub whose `run` never resolves so the forked turn stays
   * a parked fiber instead of attempting real network traffic.
   */
  readonly clientFactory?: () => Promise<unknown>;
}

/** A command approval parked while the web UI decides (see #4). */
interface PendingCommandApproval {
  readonly resolve: (approved: boolean) => void;
  readonly command: string;
}

interface FreebuffSession {
  session: ProviderSession;
  runState: RunState | undefined;
  activeTurn: { readonly turnId: TurnId; readonly abort: AbortController } | undefined;
  readonly turns: Array<{ readonly id: TurnId; items: unknown[] }>;
  /** Parked command approvals keyed by request id (web UI respondToRequest). */
  readonly pendingApprovals: Map<ApprovalRequestId, PendingCommandApproval>;
  /** Flipped by an `acceptForSession` decision: later commands run unasked. */
  autoApproveCommands: boolean;
  /**
   * Server-assigned id of the active Freebuff free session, if one has been
   * admitted. Chat completions must carry it in `codebuff_metadata` or the
   * backend answers `waiting_room_required`.
   */
  freebuffInstanceId: string | undefined;
  /**
   * Set when a session gate rejection ended the seat (`ended`) or another
   * client took it (`superseded`). `ended` clears on the next user-initiated
   * turn (which re-admits); `superseded` is terminal for this adapter.
   */
  gateState: "ended" | "superseded" | undefined;
  /**
   * Latest `rateLimitsByModel` rows the server sent (admission or poll) —
   * per-model pool status for the picker. Rows are opaque server-authored
   * data: grouped by `pool` token, never matched on values (upstream
   * `FreebuffSessionRateLimit` contract).
   */
  latestQuotaByModel: Record<string, unknown> | undefined;
}

/** SDK tool name → canonical item type (see TOOL_LIFECYCLE_ITEM_TYPES). */
function mapToolNameToItemType(toolName: string): string {
  switch (toolName) {
    case "run_terminal_command":
      return "command_execution";
    case "write_file":
    case "str_replace":
    case "apply_patch":
      return "file_change";
    case "web_search":
      return "web_search";
    default:
      return "dynamic_tool_call";
  }
}

/** Flatten the SDK's tool-result content blocks into a short display string. */
function summarizeToolOutput(output: ReadonlyArray<{ type: string; value?: unknown }>): string {
  const jsonBlocks = output.filter((block) => block.type === "json");
  if (jsonBlocks.length === 0) return "";
  try {
    const rendered = jsonBlocks.map((block) => JSON.stringify(block.value)).join(" ");
    return rendered.length > 400 ? `${rendered.slice(0, 400)}…` : rendered;
  } catch {
    return "";
  }
}

const nowIso = (): string => Effect.runSync(Effect.map(DateTime.now, DateTime.formatIso));

/**
 * Local `base-free` agent template.
 *
 * The SDK resolves the agent for a run in two ways: a LOCAL template map
 * (built from `agentDefinitions` / an object-valued `agent`), or a DATABASE
 * fetch (`/api/v1/agents/{org}/{id}/latest`). Freebuff's free-tier template
 * `base-free` is NOT a published database agent — that endpoint returns 404
 * even with a valid token — so any path that falls through to the DB fetch
 * hangs the run forever. Supplying the definition here (and passing it as an
 * object to `run()`) registers it as a local template, so resolution succeeds
 * without touching the network. This mirrors what the real Freebuff CLI does:
 * it ships these templates locally rather than fetching them.
 *
 * The model follows the turn's selection, paired with its base3 agent id via
 * `resolveFreebuffAgentForModel` (@t3tools/contracts) — a model may only be
 * requested through its allowlisted pairing or the backend 403s with
 * free_mode_invalid_agent_model.
 * The system prompt is self-contained: the SDK does NOT substitute the
 * `{CODEBUFF_*}` placeholders the upstream base3 harness uses, so they are
 * inlined or dropped here.
 */
function makeFreebuffBaseAgent(model: string | undefined): AgentDefinition {
  const resolvedModel =
    model !== undefined && model in FREEBUFF_FREE_AGENT_BY_MODEL
      ? model
      : DEFAULT_FREEBUFF_FREE_MODEL;
  return {
  id: resolveFreebuffAgentForModel(model),
  displayName: "Buffy",
  model: resolvedModel,
  providerOptions: { data_collection: "deny" },
  outputMode: "last_message",
  includeMessageHistory: true,
  inputSchema: {
    prompt: {
      type: "string",
      description: "A coding task to complete",
    },
  },
  toolNames: [
    "read_files",
    "str_replace",
    "write_file",
    "run_terminal_command",
    "code_search",
    "glob",
    "list_directory",
    "write_todos",
    "web_search",
  ],
  systemPrompt: `You are Buffy, the coding agent behind Codebuff. You help users with software engineering tasks: fixing bugs, adding functionality, refactoring, and explaining code.

- Match the project's existing conventions. Verify a library is already used in the project before employing it.
- Prefer editing existing files over creating new ones. Make the fewest changes that address the request.
- Verify non-trivial changes by running the project's typecheck and relevant tests.
- Use write_todos to plan and track multi-step tasks.
- Your responses are displayed in a terminal. Keep them short and concise.
- Don't run destructive or hard-to-undo commands (git push, resets, deploys) unless the user asks for them.

You are running on the ${resolvedModel} model. You are the AI agent behind Freebuff, a tool where users can chat with you to code with AI for free. See freebuff.com for more information about the product.
`,
  };
}

/** Typed wrapper for a rejected SDK run (see Effect.tryPromise below). */
class FreebuffRunFailure extends Data.TaggedError("FreebuffRunFailure")<{
  readonly cause: unknown;
}> {}

export const makeFreebuffAdapter = (options: MakeFreebuffAdapterOptions): Effect.Effect<
  ProviderAdapterShape<ProviderAdapterError>,
  never,
  Scope.Scope | Crypto.Crypto
> =>
  Effect.gen(function* () {
    const { config, instanceId, usageRef, fetchImpl, clientFactory } = options;
    const crypto = yield* Crypto.Crypto;
    const newUuid = (): string => Effect.runSync(crypto.randomUUIDv4);
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    // The adapter's lifetime is the driver instance's scope: turns forked
    // from sendTurn live here so registry teardown interrupts in-flight runs.
    const scope = yield* Scope.Scope;
    // The SDK cannot inject `freebuff_instance_id` into `codebuff_metadata`,
    // and free-mode chat completions 403/waiting-room without it. The
    // interceptor merges it in at the transport layer, scoped per turn.
    installFreebuffFetchInterceptor();
    let eventCount = 0;
    const sessions = new Map<ThreadId, FreebuffSession>();

    const emit = (event: ProviderRuntimeEvent) => Queue.offer(runtimeEvents, event);
    const makeEventId = () => {
      eventCount += 1;
      return EventId.make(`freebuff:${instanceId}:${eventCount}:${newUuid()}`);
    };

    // SDK callbacks fire from promise-land inside the run; fire-and-forget
    // onto the queue is the right delivery semantic (unbounded queue:
    // offer never blocks or drops).
    const emitFromCallback = (event: ProviderRuntimeEvent) => {
      Effect.runFork(emit(event));
    };

    const baseEvent = (threadId: ThreadId, turnId: TurnId | undefined) => ({
      eventId: makeEventId(),
      provider: FREEBUFF_DRIVER_KIND,
      threadId,
      createdAt: nowIso(),
      ...(turnId !== undefined ? { turnId } : {}),
    });

    const sessionNotFound = (threadId: ThreadId) =>
      new ProviderAdapterSessionNotFoundError({
        provider: "freebuff",
        threadId: String(threadId),
      });

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
      Effect.sync(() => {
        const createdAt = nowIso();
        const session: ProviderSession = {
          provider: FREEBUFF_DRIVER_KIND,
          status: "ready",
          runtimeMode: input.runtimeMode,
          threadId: input.threadId,
          ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
          createdAt,
          updatedAt: createdAt,
        };
        sessions.set(input.threadId, {
          session,
          runState: undefined,
          activeTurn: undefined,
          turns: [],
          pendingApprovals: new Map(),
          autoApproveCommands: false,
          freebuffInstanceId: undefined,
          gateState: undefined,
          latestQuotaByModel: undefined,
        });
        return session;
      });

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const state = sessions.get(input.threadId);
        if (!state) {
          return yield* Effect.fail(sessionNotFound(input.threadId));
        }
        if (!input.input) {
          return yield* new ProviderAdapterValidationError({
            provider: "freebuff",
            operation: "sendTurn",
            issue: "Freebuff turns require a text prompt.",
          });
        }
        if (!config.apiKey) {
          return yield* new ProviderAdapterValidationError({
            provider: "freebuff",
            operation: "sendTurn",
            issue:
              "No Codebuff API key configured. Add one in settings (free key: codebuff.com/api-keys).",
          });
        }
        if (state.activeTurn) {
          return yield* new ProviderAdapterValidationError({
            provider: "freebuff",
            operation: "sendTurn",
            issue: `Thread ${String(input.threadId)} already has an active turn.`,
          });
        }

        // A superseded seat is terminal: another client owns the account's
        // session; fighting it would make the two clients take turns killing
        // each other's sessions.
        if (state.gateState === "superseded") {
          return yield* Effect.fail(
            new ProviderAdapterRequestError({
              provider: "freebuff",
              method: "sendTurn",
              detail:
                "Another OpenBuff session took over this account. Close the other session, then reload here.",
            }),
          );
        }
        // Session gates end the seat but not the thread: the next
        // user-initiated turn re-admits (fresh admission below) instead of a
        // background retry loop, which upstream measurements tied to burned
        // admissions.
        if (state.gateState === "ended") {
          state.gateState = undefined;
          state.freebuffInstanceId = undefined;
          state.runState = undefined;
        }

        const turnId = TurnId.make(`freebuff-turn-${newUuid()}`);
        const abort = new AbortController();
        state.activeTurn = { turnId, abort };
        state.session = { ...state.session, status: "running", updatedAt: nowIso() };

        const modelSelection = input.modelSelection?.model;
        yield* emit({
          ...baseEvent(input.threadId, turnId),
          type: "turn.started",
          payload: {
            ...(modelSelection !== undefined ? { model: modelSelection } : {}),
          },
        } as ProviderRuntimeEvent);

        // ── Turn-boundary session poll ──────────────────────────────────
        // One compact GET when a session exists: catches a server-ended seat
        // before a doomed turn (upstream grace semantics), never tight-polls
        // by construction, and never kills the session on poll failure (the
        // 429 lesson — unknown/failed polls proceed).
        if (state.freebuffInstanceId !== undefined) {
          const instanceId = state.freebuffInstanceId;
          const poll = yield* Effect.tryPromise({
            try: () =>
              pollFreebuffSession(config.apiKey, instanceId, {
                signal: abort.signal,
                ...(fetchImpl !== undefined ? { fetch: fetchImpl } : {}),
              }),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: "freebuff",
                method: "sendTurn",
                detail:
                  cause instanceof Error
                    ? cause.message
                    : "Freebuff session poll failed.",
              }),
          }).pipe(Effect.orElseSucceed(() => null));
          if (poll !== null) {
            if (usageRef !== undefined) {
              usageRef.current = mergeProviderUsage(usageRef.current, usageFromSessionResponse(poll));
            }
            if (poll.rateLimitsByModel !== undefined) {
              state.latestQuotaByModel = poll.rateLimitsByModel;
            }
            const cls = classifySessionPoll(poll);
            switch (cls.kind) {
              case "gone":
                // Fully gone: clear so the admission block below rejoins via
                // the admission POST (the user's own turn is the trigger —
                // no retry loop).
                state.freebuffInstanceId = undefined;
                state.runState = undefined;
                break;
              case "grace": {
                state.activeTurn = undefined;
                state.session = { ...state.session, status: "ready", updatedAt: nowIso() };
                const remaining =
                  cls.graceRemainingMs !== undefined
                    ? ` (~${Math.ceil(cls.graceRemainingMs / 1000)}s of grace left)`
                    : "";
                return yield* Effect.fail(
                  new ProviderAdapterRequestError({
                    provider: "freebuff",
                    method: "sendTurn",
                    detail: `Freebuff session ended${remaining}. In-flight work finishes, but new prompts need a fresh session — send another message to rejoin.`,
                  }),
                );
              }
              case "superseded":
                state.gateState = "superseded";
                state.activeTurn = undefined;
                state.session = { ...state.session, status: "ready", updatedAt: nowIso() };
                return yield* Effect.fail(
                  new ProviderAdapterRequestError({
                    provider: "freebuff",
                    method: "sendTurn",
                    detail:
                      "Another OpenBuff session took over this account. Close the other session, then reload here.",
                  }),
                );
              case "blocked":
                state.activeTurn = undefined;
                state.session = { ...state.session, status: "ready", updatedAt: nowIso() };
                return yield* Effect.fail(
                  new ProviderAdapterRequestError({
                    provider: "freebuff",
                    method: "sendTurn",
                    detail: `Freebuff free mode is unavailable for this account (${cls.status}).`,
                  }),
                );
              default:
                // active / unknown: proceed — an odd poll must never kill a
                // live session.
                break;
            }
          }
        }

        // ── Free-session admission ────────────────────────────────────────
        // Free-mode chat completions are gated behind an ACTIVE free session
        // (the backend answers `waiting_room_required` without one). Admit
        // once per thread and reuse the server-assigned instance id for every
        // subsequent turn; re-admit if a previous admission was never made.
        if (state.freebuffInstanceId === undefined) {
          const admission = yield* Effect.tryPromise({
            try: () =>
              establishFreebuffSession(config.apiKey, {
                signal: abort.signal,
                ...(modelSelection !== undefined ? { model: modelSelection } : {}),
                ...(fetchImpl !== undefined ? { fetch: fetchImpl } : {}),
              }),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: "freebuff",
                method: "sendTurn",
                detail:
                  cause instanceof Error
                    ? cause.message
                    : "Failed to start a Freebuff free session.",
              }),
          });
          if (admission.status !== "active" || admission.instanceId === undefined) {
            state.activeTurn = undefined;
            state.session = { ...state.session, status: "ready", updatedAt: nowIso() };
            // Gate refusals get their upstream-documented prose; everything
            // else keeps the generic status + message shape.
            const detail =
              admission.status === "model_unavailable"
                ? formatModelUnavailableProse(admission)
                : admission.status === "model_locked"
                  ? `Freebuff is already running ${admission.currentModel ?? "another model"} for you. Finish that session (or retry) before switching to ${admission.requestedModel ?? "the requested model"}.`
                  : `Freebuff could not start a free session (${admission.status}). ${admission.message ?? "Try again shortly."}`;
            return yield* Effect.fail(
              new ProviderAdapterRequestError({
                provider: "freebuff",
                method: "sendTurn",
                detail,
              }),
            );
          }
          state.freebuffInstanceId = admission.instanceId;
          state.latestQuotaByModel = admission.rateLimitsByModel;
          if (usageRef !== undefined) {
            usageRef.current = mergeProviderUsage(
              usageRef.current,
              usageFromSessionResponse(admission),
            );
          }
        }

        const client = (clientFactory
          ? yield* Effect.promise(() => clientFactory())
          : new CodebuffClient({
              apiKey: config.apiKey,
              // Surface SDK internals on stderr: without a logger the run()
              // promise can fail silently (invalid agent, auth, network). The SDK
              // fires these callbacks from promise-land, outside any Effect
              // runtime, so they go straight to stderr rather than Effect.log*.
              logger: {
                debug: () => {},
                info: () => {},
                warn: (...args: unknown[]) =>
                  process.stderr.write(`[freebuff-sdk:warn] ${args.map(String).join(" ")}\n`),
                error: (...args: unknown[]) =>
                  process.stderr.write(`[freebuff-sdk:error] ${args.map(String).join(" ")}\n`),
              } as never,
            })) as CodebuffClient;
        const prompt = input.input;
        const previousRun = state.runState;
        const cwd = state.session.cwd;
        const threadId = input.threadId;

        let assistantText = "";

        // ── Command approval bridge (#4) ────────────────────────────────
        // Parks an approval on a promise the web UI resolves via
        // respondToRequest; auto-denies if the turn is interrupted.
        const requestCommandApproval = (
          command: string,
          rawInput: unknown,
        ): Promise<boolean> =>
          new Promise<boolean>((resolve) => {
            const requestId = ApprovalRequestId.make(`freebuff-req-${newUuid()}`);
            state.pendingApprovals.set(requestId, {
              resolve: (approved) => {
                if (approved) state.autoApproveCommands = true;
                resolve(approved);
              },
              command,
            });
            emitFromCallback({
              ...baseEvent(threadId, turnId),
              requestId,
              type: "request.opened",
              payload: {
                requestType: "command_execution_approval",
                detail: command,
                args: rawInput,
              },
            } as unknown as ProviderRuntimeEvent);
            const onAbort = () => {
              if (state.pendingApprovals.delete(requestId)) {
                emitFromCallback({
                  ...baseEvent(threadId, turnId),
                  requestId,
                  type: "request.resolved",
                  payload: {
                    requestType: "command_execution_approval",
                    decision: "cancel",
                  },
                } as unknown as ProviderRuntimeEvent);
                resolve(false);
              }
            };
            abort.signal.addEventListener("abort", onAbort, { once: true });
          });

        // The free-session instance id is guaranteed here: admission above
        // either set it or failed the turn.
        const freebuffInstanceId = state.freebuffInstanceId as string;

        const runEffect = Effect.tryPromise({
          try: () =>
            // Run inside the session scope so the fetch interceptor merges
            // `freebuff_instance_id` into every chat-completion request's
            // `codebuff_metadata`. Without it the backend answers
            // `waiting_room_required` and the turn produces nothing.
            runWithFreebuffSession(freebuffInstanceId, () =>
              client.run({
                // Pass the agent as an OBJECT, not a string id. The SDK
                // registers object agents as local templates (keyed by id) and
                // resolves them in-process. A string id instead falls through
                // to a database fetch of a published agent — and the free-mode
                // roots are not published (404), which hangs the run silently.
                agent: makeFreebuffBaseAgent(modelSelection),
                costMode: "free",
                prompt,
                ...(previousRun !== undefined ? { previousRun } : {}),
                signal: abort.signal,
                ...(cwd !== undefined ? { cwd } : {}),
                overrideTools: {
                  run_terminal_command: async (
                    toolInput: ClientToolCall<"run_terminal_command">["input"],
                  ): Promise<CodebuffToolOutput<"run_terminal_command">> => {
                    const command = toolInput.command;
                    // Supervised modes gate every command; full-access and
                    // sessions that got acceptForSession run unasked.
                    const needsApproval =
                      state.session.runtimeMode !== "full-access" && !state.autoApproveCommands;
                    if (needsApproval && !(await requestCommandApproval(command, toolInput))) {
                      return {
                        exitCode: 1,
                        stdout: "",
                        stderr: "User declined to run this command.",
                        cancelled: true,
                      } as unknown as CodebuffToolOutput<"run_terminal_command">;
                    }
                    return ToolHelpers.runTerminalCommand({
                      command,
                      process_type: toolInput.process_type === "BACKGROUND" ? "BACKGROUND" : "SYNC",
                      cwd: toolInput.cwd || cwd || process.cwd(),
                      timeout_seconds: toolInput.timeout_seconds ?? 120,
                    });
                  },
                },
              handleStreamChunk: (chunk) => {
                if (typeof chunk === "string") {
                  if (chunk) {
                    assistantText += chunk;
                    emitFromCallback({
                      ...baseEvent(threadId, turnId),
                      type: "content.delta",
                      payload: { streamKind: "assistant_text", delta: chunk },
                    } as ProviderRuntimeEvent);
                  }
                  return;
                }
                if (chunk.type === "reasoning_chunk") {
                  emitFromCallback({
                    ...baseEvent(threadId, turnId),
                    type: "content.delta",
                    payload: { streamKind: "reasoning_text", delta: chunk.chunk },
                  } as ProviderRuntimeEvent);
                }
              },
              handleEvent: (event: PrintModeEvent) => {
                // Error events are the ones that would otherwise vanish; the
                // SDK reports agent failures here rather than rejecting run().
                if (event.type === "error" || event.type === "prompt-error") {
                  process.stderr.write(
                    `[freebuff-sdk:event] ${JSON.stringify(event).slice(0, 400)}\n`,
                  );
                }
                if (event.type === "tool_call") {
                  emitFromCallback({
                    ...baseEvent(threadId, turnId),
                    type: "item.started",
                    payload: {
                      itemType: mapToolNameToItemType(event.toolName),
                      title: event.toolName,
                      data: event.input,
                    },
                  } as ProviderRuntimeEvent);
                } else if (event.type === "tool_result") {
                  emitFromCallback({
                    ...baseEvent(threadId, turnId),
                    type: "item.completed",
                    payload: {
                      itemType: mapToolNameToItemType(event.toolName),
                      status: "completed",
                      title: event.toolName,
                      detail: summarizeToolOutput(event.output),
                    },
                  } as ProviderRuntimeEvent);
                }
              },
              })
            ),
          catch: (cause) => new FreebuffRunFailure({ cause }),
        });

        // The turn runs detached in the instance scope: sendTurn returns as
        // soon as the run is started (orchestration owns turn lifecycle).
        yield* Effect.forkIn(scope)(
          runEffect.pipe(
            Effect.matchEffect({
              onSuccess: (runState) =>
                Effect.sync(() => {
                    state.runState = runState;
                    state.turns.push({
                      id: turnId,
                      items: [
                        { type: "userMessage", content: [{ type: "text", text: prompt }] },
                        ...(assistantText ? [{ type: "agentMessage", text: assistantText }] : []),
                      ],
                    });
                    state.activeTurn = undefined;
                    state.session = { ...state.session, status: "ready", updatedAt: nowIso() };
                  }).pipe(
                  Effect.andThen(
                    emit({
                      ...baseEvent(threadId, turnId),
                      type: "turn.completed",
                      payload: { state: "completed" },
                    } as ProviderRuntimeEvent),
                  ),
                ),
              onFailure: (failure) => {
                const cause = failure.cause;
                const aborted =
                  abort.signal.aborted ||
                  (cause instanceof Error && cause.name === "AbortError");
                // Session gate rejections carry an (error code, status) pair
                // on the thrown error; classify before any generic handling.
                const gateCode = classifyFreebuffGate(cause);
                const disposition =
                  gateCode !== null ? freebuffGateDisposition(gateCode) : undefined;
                if (gateCode !== null) {
                  if (disposition === "ended" || disposition === "superseded") {
                    state.gateState = disposition;
                  }
                }
                // The backend returns 402 "Out of credits" when a paid model is
                // requested on a free/limited account. Surface a clear,
                // actionable message instead of the raw SDK error text.
                const causeText = cause instanceof Error ? cause.message : String(cause);
                const isOutOfCredits =
                  /out of credits/i.test(causeText) ||
                  /402/.test(causeText) ||
                  (cause instanceof Error &&
                    "statusCode" in cause &&
                    (cause as { statusCode?: number }).statusCode === 402);
                const gateMessage = gateUserMessage(gateCode);
                const errorMessage = isOutOfCredits
                  ? "This model requires credits your account doesn't have. Free-tier accounts are limited to the models Freebuff assigns (currently DeepSeek V4 Flash). Switch back to the default model, or add credits at codebuff.com/usage."
                  : (gateMessage ?? causeText);
                const failureEffect = aborted
                  ? emit({
                      ...baseEvent(threadId, turnId),
                      type: "turn.aborted",
                      payload: { reason: "Interrupted by user" },
                    } as ProviderRuntimeEvent)
                  : emit({
                      ...baseEvent(threadId, turnId),
                      type: "turn.completed",
                      payload: {
                        state: "failed",
                        errorMessage,
                      },
                    } as ProviderRuntimeEvent);
                return Effect.sync(() => {
                  state.activeTurn = undefined;
                  state.session = {
                    ...state.session,
                    // Seat-ending and takeover gates leave the session visibly
                    // broken until the next turn re-admits (or the client
                    // reloads, for a takeover).
                    status:
                      disposition === "ended" || disposition === "superseded"
                        ? ("error" as const)
                        : ("ready" as const),
                    updatedAt: nowIso(),
                    ...(gateMessage !== undefined ? { lastError: gateMessage } : {}),
                  };
                }).pipe(Effect.andThen(failureEffect));
              },
            }),
          ),
        );

        return { threadId: input.threadId, turnId } satisfies ProviderTurnStartResult;
      }).pipe(
        Effect.withSpan("FreebuffAdapter.sendTurn", {
          attributes: { threadId: String(input.threadId) },
        }),
      );

    const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (
      threadId,
    ) =>
      Effect.suspend(() => {
        const state = sessions.get(threadId);
        if (!state) return Effect.fail<ProviderAdapterError>(sessionNotFound(threadId));
        state.activeTurn?.abort.abort();
        return Effect.void;
      });

    const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.suspend(() => {
        const state = sessions.get(threadId);
        if (!state) {
          return Effect.fail<ProviderAdapterError>(sessionNotFound(threadId));
        }
        const pending = state.pendingApprovals.get(requestId);
        if (!pending) {
          return Effect.fail(
            new ProviderAdapterRequestError({
              provider: "freebuff",
              method: "respondToRequest",
              detail: `No pending approval '${String(requestId)}' on this thread.`,
            }),
          );
        }
        state.pendingApprovals.delete(requestId);
        const approved = decision === "accept" || decision === "acceptForSession";
        return emit({
          ...baseEvent(threadId, state.activeTurn?.turnId),
          requestId,
          type: "request.resolved",
          payload: {
            requestType: "command_execution_approval",
            decision,
          },
        } as unknown as ProviderRuntimeEvent).pipe(
          Effect.andThen(
            Effect.sync(() => {
              pending.resolve(approved);
            }),
          ),
        );
      });

    const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
      threadId,
    ) =>
      Effect.suspend(() => {
        if (!sessions.has(threadId)) {
          return Effect.fail<ProviderAdapterError>(sessionNotFound(threadId));
        }
        return Effect.void;
      });

    /**
     * Explicit upstream release on stop (issue #55, server half). Fires only
     * when this adapter owns a live seat: never for `superseded` (another
     * client owns the seat — a DELETE here would evict *their* session), and
     * never when no admission happened. Never fails `stopSession` — the
     * upstream sweep is the backstop when the DELETE cannot get through.
     */
    const releaseUpstreamSeat = (state: FreebuffSession): Effect.Effect<void> => {
      if (state.gateState === "superseded") return Effect.void;
      const instanceId = state.freebuffInstanceId;
      if (instanceId === undefined) return Effect.void;
      return Effect.ignoreCause(
        Effect.promise(() =>
          releaseFreebuffSession(config.apiKey, instanceId, {
            ...(fetchImpl !== undefined ? { fetch: fetchImpl } : {}),
          }),
        ),
      );
    };

    const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
      Effect.suspend(() => {
        const state = sessions.get(threadId);
        if (!state) return Effect.fail<ProviderAdapterError>(sessionNotFound(threadId));
        state.activeTurn?.abort.abort();
        return Effect.asVoid(
          Effect.andThen(
            releaseUpstreamSeat(state),
            Effect.sync(() => {
              sessions.delete(threadId);
            }),
          ),
        );
      });

    const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
      Effect.sync(() => [...sessions.values()].map((state) => state.session));

    const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
      Effect.sync(() => sessions.has(threadId));

    const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) =>
      Effect.suspend(() => {
        const state = sessions.get(threadId);
        if (!state) return Effect.fail<ProviderAdapterError>(sessionNotFound(threadId));
        const snapshot: ProviderThreadSnapshot = {
          threadId,
          turns: state.turns.map((turn) => ({ id: turn.id, items: turn.items })),
        };
        return Effect.succeed(snapshot);
      });

    const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = (
      threadId,
    ) =>
      Effect.suspend(() => {
        const state = sessions.get(threadId);
        if (!state) return Effect.fail<ProviderAdapterError>(sessionNotFound(threadId));
        // v1 no-op: the SDK exposes no conversation rewind. The
        // orchestration layer's checkpoint revert (#8) is the real path.
        const snapshot: ProviderThreadSnapshot = {
          threadId,
          turns: state.turns.map((turn) => ({ id: turn.id, items: turn.items })),
        };
        return Effect.succeed(snapshot);
      });

    const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
      Effect.gen(function* () {
        for (const state of sessions.values()) {
          state.activeTurn?.abort.abort();
          yield* releaseUpstreamSeat(state);
        }
        sessions.clear();
      });

    return {
      provider: FREEBUFF_DRIVER_KIND,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      streamEvents: Stream.fromQueue(runtimeEvents),
    };
  });
