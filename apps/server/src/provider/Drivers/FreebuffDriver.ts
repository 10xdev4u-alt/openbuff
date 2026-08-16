/**
 * FreebuffDriver — the single OpenBuff engine.
 *
 * Wraps `@codebuff/sdk` in the provider SPI: the SDK runs the entire agent
 * loop (tools, models, routing through the Codebuff backend) in-process, so
 * unlike the CLI-backed drivers this one has no binary to probe, no
 * maintenance updates, and no per-instance subprocess — `create` only
 * materializes the adapter closure and a static snapshot.
 *
 * Freebuff has no API keys: auth reuses the Freebuff CLI's browser-login
 * session from ~/.config/manicode/credentials.json (settings override and
 * CODEBUFF_API_KEY env win when set). The snapshot's auth state reflects
 * whether a usable token resolved; the web UI surfaces it.
 *
 * @module provider/Drivers/FreebuffDriver
 */
import { FreebuffSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeOS from "node:os";
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

export type FreebuffDriverEnv = Crypto.Crypto | FileSystem.FileSystem | Path.Path;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/**
 * Local heuristic text generation until the SDK route lands (follow-up to
 * #3): thread titles / commit subjects / branch names derived from the
 * input without a model call. Deterministic, zero-cost, clearly marked.
 */

interface ResolvedFreebuffAuth {
  readonly token: string;
  readonly email: string | undefined;
}

/**
 * Freebuff has no API keys: the CLI (and Desktop app) authenticate through a
 * browser login that stores a session token at ~/.config/manicode/credentials.json
 * (`default.authToken`). Resolution order: explicit settings override, then
 * CODEBUFF_API_KEY env, then the shared CLI login.
 */
const resolveAuth = (
  override: string,
): Effect.Effect<ResolvedFreebuffAuth, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const trimmedOverride = override.trim();
    if (trimmedOverride.length > 0) {
      return { token: trimmedOverride, email: undefined };
    }
    const fromEnv = process.env["CODEBUFF_API_KEY"]?.trim() ?? "";
    if (fromEnv.length > 0) {
      return { token: fromEnv, email: undefined };
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const credentialsPath = path.join(
      NodeOS.homedir(),
      ".config",
      "manicode",
      "credentials.json",
    );
    const contents = yield* fileSystem
      .readFileString(credentialsPath)
      .pipe(Effect.orElseSucceed(() => null));
    if (contents === null) {
      return { token: "", email: undefined };
    }
    const parsedUnknown = yield* Schema.decodeUnknownEffect(Schema.Json)(
      contents,
    ).pipe(Effect.orElseSucceed(() => null));
    const parsed =
      typeof parsedUnknown === "object" && parsedUnknown !== null
        ? (parsedUnknown as { default?: { authToken?: unknown; email?: unknown } })
        : null;
    const user = parsed?.default ?? {};
    return {
      token: typeof user.authToken === "string" ? user.authToken.trim() : "",
      email: typeof user.email === "string" ? user.email : undefined,
    };
  });

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
      // Captured for the snapshot's refresh closure: ServerProviderShape
      // demands R = never, so the services are provided explicitly there.
      const fileSystemService = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const resolveAuthNow = (override: string) =>
        resolveAuth(override).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystemService),
          Effect.provideService(Path.Path, pathService),
        );

      const auth = yield* resolveAuthNow(input.config.apiKey);
      const hasKey = auth.token.length > 0;

      const snapshotDraft = buildServerProvider({
        driver: FREEBUFF_DRIVER,
        presentation: { displayName: "Freebuff" },
        enabled: input.enabled,
        checkedAt: yield* nowIso,
        models: [],
        probe: {
          installed: true,
          version: null,
          // Missing key is a setup nudge, not a broken install: "warning"
          // keeps the provider selectable in the composer (a send without a
          // key fails with a clear validation message), while "error" would
          // exile it to "No provider available".
          status: hasKey ? "ready" : "warning",
          auth: {
            status: hasKey ? "authenticated" : "unauthenticated",
            type: "freebuff_cli",
            label: hasKey
              ? auth.email !== undefined
                ? `Freebuff login (${auth.email})`
                : "Freebuff login"
              : "Freebuff CLI login",
            ...(auth.email !== undefined && hasKey ? { email: auth.email } : {}),
          },
          ...(hasKey
            ? {}
            : {
                message:
                  "No Freebuff login found — run `freebuff login` (or log into the Freebuff Desktop app); OpenBuff reuses that session automatically.",
              }),
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
        refresh: Effect.flatMap(resolveAuthNow(input.config.apiKey), (nextAuth) =>
          Effect.sync(() => {
            current = {
              ...current,
              auth: {
                status: nextAuth.token.length > 0 ? ("authenticated" as const) : ("unauthenticated" as const),
                type: "freebuff_cli",
                label:
                  nextAuth.token.length > 0
                    ? nextAuth.email !== undefined
                      ? `Freebuff login (${nextAuth.email})`
                      : "Freebuff login"
                    : "Freebuff CLI login",
                ...(nextAuth.email !== undefined && nextAuth.token.length > 0
                  ? { email: nextAuth.email }
                  : {}),
              },
              status: nextAuth.token.length > 0 ? ("ready" as const) : ("warning" as const),
              ...(nextAuth.token.length > 0
                ? {}
                : {
                    message:
                      "No Freebuff login found — run `freebuff login` (or log into the Freebuff Desktop app); OpenBuff reuses that session automatically.",
                  }),
            };
            return current;
          }),
        ),
        // Emit the snapshot once on subscribe so late subscribers (the web
        // UI) receive initial provider state immediately — unlike t3's
        // CLI drivers there is no background probe re-emitting it.
        streamChanges: Stream.fromEffect(Effect.succeed(current)),
      };

      const adapter = yield* makeFreebuffAdapter({
        config: { ...input.config, apiKey: auth.token },
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

