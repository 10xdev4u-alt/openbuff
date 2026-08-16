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
import type {
  ProviderAdapterShape,
  ProviderThreadSnapshot,
} from "./ProviderAdapter.ts";
import type { FreebuffSettings } from "@t3tools/contracts";

export const FREEBUFF_DRIVER_KIND = ProviderDriverKind.make("freebuff");

export interface MakeFreebuffAdapterOptions {
  readonly config: FreebuffSettings;
  readonly instanceId: string;
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
    const { config, instanceId } = options;
    const crypto = yield* Crypto.Crypto;
    const newUuid = (): string => Effect.runSync(crypto.randomUUIDv4);
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    // The adapter's lifetime is the driver instance's scope: turns forked
    // from sendTurn live here so registry teardown interrupts in-flight runs.
    const scope = yield* Scope.Scope;
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

        const client = new CodebuffClient({ apiKey: config.apiKey });
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

        const runEffect = Effect.tryPromise({
          try: () =>
            client.run({
              agent: config.agent,
              prompt,
              ...(previousRun !== undefined ? { previousRun } : {}),
              signal: abort.signal,
              ...(cwd !== undefined ? { cwd } : {}),
              ...(modelSelection !== undefined ? { params: { model: modelSelection } } : {}),
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
            }),
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
                        errorMessage: cause instanceof Error ? cause.message : String(cause),
                      },
                    } as ProviderRuntimeEvent);
                return Effect.sync(() => {
                  state.activeTurn = undefined;
                  state.session = {
                    ...state.session,
                    status: "ready",
                    updatedAt: nowIso(),
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

    const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
      Effect.suspend(() => {
        const state = sessions.get(threadId);
        if (!state) return Effect.fail<ProviderAdapterError>(sessionNotFound(threadId));
        state.activeTurn?.abort.abort();
        sessions.delete(threadId);
        return Effect.void;
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
      Effect.sync(() => {
        for (const state of sessions.values()) {
          state.activeTurn?.abort.abort();
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
