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
import {
  DEFAULT_FREEBUFF_FREE_MODEL,   FREEBUFF_FREE_PICKER_MODEL_IDS,
   FREEBUFF_PLAN_REQUIRED_MODEL_SLUGS_ORDERED,
  FreebuffSettings,
  ProviderDriverKind,
  type FreebuffProviderUsage,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
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
import { mergeProviderUsage } from "../providerUsageMerge.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";

/**
 * Upstream display names for the free-tier picker (upstream
 * `common/src/constants/freebuff-models.ts` model entries). The slug set is
 * owned by the contracts picker list (`FREEBUFF_FREE_PICKER_MODEL_IDS`); this
 * only supplies what the picker renders. Reconciled to the live roster
 * verified 2026-09-26: solar-pro4 RETURNED on 09-25 (name from its restored
 * row); gpt-6-luna and mimo-v2.6-pro are plan-only at this tier's access
 * level and have no entry; gpt-5.6-luna was PAUSED 2026-09-24 (drain picks
 * coerce at admission now). Withdrawn rows (v4-pro, minimax-m3, ox-alpha,
 * glm-5.2, muse-spark-1.3) and god-only rows (kimi-k3-eco, luna-es) have no
 * entry.
 *
 * The MiMo wire id is stable but the serving build moved: MiMo 2.6 Flash
 * since 2026-09-21 under the unchanged id (same Xiaomi rate card to the
 * cent), so the label carries the version the wire actually serves —
 * re-verified against the live catalog 2026-09-26.
 */
const FREEBUFF_MODEL_DISPLAY_NAME_BY_SLUG: Readonly<Record<string, string>> = {
  "z-ai/glm-5.3-flash": "GLM 5.3 Flash",
  "deepseek/deepseek-v4-flash": "DeepSeek V4.1 Flash",
  "mimo/mimo-v2.5": "MiMo 2.6 Flash",
  "upstage/solar-mini4": "Solar Mini 4",
  "upstage/solar-pro4": "Solar Pro 4",
  "stealth/space-bunny-alpha": "Space Bunny Alpha",
  "meta/muse-spark-1.2-contributor": "Muse Spark 1.2",
  // Tier-LOCKED rows: LISTED, not hidden (upstream's freebuffPlanRequired
  // doctrine, common/src/util/freebuff-model-selection.ts) — the thing
  // standing between the user and the row is a plan we do not sell here,
  // and hiding it gives the upgrade nothing to point at. The web picker
  // draws them disabled with FREEBUFF_PLAN_REQUIRED_LINE; admission would
  // refuse them regardless, and the contracts offer-without-gate test pins
  // that none of these is servable.
  "openai/gpt-6-luna": "GPT-6 Luna",
  "mimo/mimo-v2.6-pro": "MiMo 2.6 Pro",
  "google/gemini-3.8-flash": "Gemini 3.8 Flash",
};

/**
 * The free-tier picker rows: the picker-subset from contracts
 * (`FREEBUFF_FREE_PICKER_MODEL_IDS`), flash pinned as the tier default.
 * Deliberately NOT the full pairing map — the drain row (solar-pro4, while
 * it was picker-retired 09-23→09-25) stayed resolvable at admission for
 * draining sessions; it has since RETURNED to the picker (2026-09-25).
 * Capabilities stay null (the base3 agents take no runtime
 * options); the adapter derives the agent per selected slug.
 */
export function freebuffSnapshotModels(): ReadonlyArray<ServerProviderModel> {
  return [
    ...FREEBUFF_FREE_PICKER_MODEL_IDS.map((slug) => ({
      slug,
      name: FREEBUFF_MODEL_DISPLAY_NAME_BY_SLUG[slug] ?? slug,
      isCustom: false,
      // Explicit `false` so the picker's legacy section never claims a
      // current row just because a sibling carries `isLegacy: true`.
      isLegacy: false,
      capabilities: null,
      ...(slug === DEFAULT_FREEBUFF_FREE_MODEL ? { isDefault: true } : {}),
    })),
    ...FREEBUFF_PLAN_REQUIRED_MODEL_SLUGS_ORDERED.map((slug) => ({
      slug,
      name: FREEBUFF_MODEL_DISPLAY_NAME_BY_SLUG[slug] ?? slug,
      isCustom: false,
      // NOT legacy — these rows are tier-locked, drawn INLINE and disabled
      // (upstream draws them listed with a plan-required label, never behind
      // a collapsed/legacy section; that would be hiding again).
      isLegacy: false,
      capabilities: null,
    })),
  ];
}
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
    const credentialsPath = path.join(NodeOS.homedir(), ".config", "manicode", "credentials.json");
    const contents = yield* fileSystem
      .readFileString(credentialsPath)
      .pipe(Effect.orElseSucceed(() => null));
    if (contents === null) {
      return { token: "", email: undefined };
    }
    // `Schema.Json` is the schema of already-parsed JSON values, so decoding a
    // raw string against it succeeds trivially and returns the string unchanged.
    // `fromJsonString` is what actually parses the JSON text into a value.
    const parsedUnknown = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
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
        models: freebuffSnapshotModels(),
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

      // Session responses update this box (adapter capture, issue #31); the
      // snapshot closure reads it so web sees the freshest meter. Initialized
      // from the draft so a re-created driver keeps the last known usage.
      const usageRef: { current: FreebuffProviderUsage | undefined } = { current: undefined };

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
            const usage = mergeProviderUsage(current.usage, usageRef.current);
            current = {
              ...(usage !== undefined ? { usage } : {}),
              ...current,
              auth: {
                status:
                  nextAuth.token.length > 0
                    ? ("authenticated" as const)
                    : ("unauthenticated" as const),
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
        usageRef,
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
