/**
 * FreebuffDriver — the single OpenBuff engine.
 *
 * Wraps `@codebuff/sdk` in the provider SPI: the SDK runs the entire agent
 * loop (tools, models, routing through the Codebuff backend) in-process, so
 * unlike the CLI-backed drivers this one has no binary to probe, no
 * maintenance updates, and no per-instance subprocess — `create` only
 * materializes the adapter closure and a static snapshot.
 *
 * The snapshot's `auth` state reflects whether an API key is configured
 * (free key: codebuff.com/api-keys); threads cannot run turns without it,
 * and the web UI surfaces the state from this snapshot.
 *
 * @module provider/Drivers/FreebuffDriver
 */
import { FreebuffSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as Stream from "effect/Stream";


import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { buildServerProvider } from "../providerSnapshot.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import type { ServerProviderShape } from "../Services/ServerProvider.ts";
import { makeFreebuffAdapter } from "../Services/FreebuffAdapter.ts";

export const FREEBUFF_DRIVER = ProviderDriverKind.make("freebuff");

export type FreebuffDriverEnv = Crypto.Crypto;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/**
 * Local heuristic text generation until the SDK route lands (follow-up to
 * #3): thread titles / commit subjects / branch names derived from the
 * input without a model call. Deterministic, zero-cost, clearly marked.
 */
const makeHeuristicTextGeneration = (): ProviderInstance["textGeneration"] => ({
  generateCommitMessage: (input) =>
    Effect.succeed({
      subject: input.stagedSummary.split("\n")[0]?.slice(0, 72) || "chore: update workspace",
      body: input.stagedSummary.split("\n").slice(1).join("\n").trim(),
    }),
  generatePrContent: (input) =>
    Effect.succeed({
      title: input.commitSummary.split("\n")[0]?.slice(0, 72) || "Update workspace",
      body: input.diffSummary,
    }),
  generateBranchName: (input) =>
    Effect.succeed({
      branch:
        input.message
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "openbuff-change",
    }),
  generateThreadTitle: (input) =>
    Effect.succeed({
      title: ((): string => {
        const firstLine = input.message.split("\n")[0]?.trim() ?? "";
        return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine || "New thread";
      })(),
    }),
});

export const FreebuffDriver: ProviderDriver<FreebuffSettings, FreebuffDriverEnv> = {
  driverKind: FREEBUFF_DRIVER,
  metadata: {
    displayName: "Freebuff",
  },
  configSchema: FreebuffSettings,
  defaultConfig: () => Schema.decodeSync(FreebuffSettings)({}),
  create: (input) =>
    Effect.gen(function* () {
      const hasKey = input.config.apiKey.length > 0;

      const snapshotDraft = buildServerProvider({
        driver: FREEBUFF_DRIVER,
        presentation: { displayName: "Freebuff" },
        enabled: input.enabled,
        checkedAt: yield* nowIso,
        models: [],
        probe: {
          installed: true,
          version: null,
          status: hasKey ? "ready" : "error",
          auth: {
            status: hasKey ? "authenticated" : "unauthenticated",
            type: "api_key",
            label: "Codebuff API key",
          },
          ...(hasKey ? {} : { message: "No API key set — add one in settings." }),
        },
      });

      let current: ServerProvider = {
        ...snapshotDraft,
        instanceId: input.instanceId,
        driver: FREEBUFF_DRIVER,
      };

      const snapshot: ServerProviderShape = {
        maintenanceCapabilities: makeManualOnlyProviderMaintenanceCapabilities({
          provider: FREEBUFF_DRIVER,
          packageName: null,
        }),
        getSnapshot: Effect.succeed(current),
        refresh: Effect.sync(() => {
          current = { ...current };
          return current;
        }),
        streamChanges: Stream.empty,
      };

      const adapter = yield* makeFreebuffAdapter({
        config: input.config,
        instanceId: String(input.instanceId),
      });

      return {
        instanceId: input.instanceId,
        driverKind: FREEBUFF_DRIVER,
        continuationIdentity: defaultProviderContinuationIdentity({
          driverKind: FREEBUFF_DRIVER,
          instanceId: input.instanceId,
        }),
        displayName: input.displayName,
        ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
        enabled: input.enabled,
        snapshot,
        adapter,
        textGeneration: makeHeuristicTextGeneration(),
      };
    }).pipe(
      Effect.withSpan("FreebuffDriver.create", {
        attributes: { instanceId: String(input.instanceId) },
      }),
    ),
};

