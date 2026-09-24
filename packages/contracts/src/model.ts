import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

export const ProviderOptionDescriptorType = Schema.Literals(["select", "boolean"]);
export type ProviderOptionDescriptorType = typeof ProviderOptionDescriptorType.Type;

export const ProviderOptionChoice = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  isDefault: Schema.optional(Schema.Boolean),
});
export type ProviderOptionChoice = typeof ProviderOptionChoice.Type;

const ProviderOptionDescriptorBase = {
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
} as const;

export const SelectProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("select"),
  options: Schema.Array(ProviderOptionChoice),
  currentValue: Schema.optional(TrimmedNonEmptyString),
  promptInjectedValues: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type SelectProviderOptionDescriptor = typeof SelectProviderOptionDescriptor.Type;

export const BooleanProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("boolean"),
  currentValue: Schema.optional(Schema.Boolean),
});
export type BooleanProviderOptionDescriptor = typeof BooleanProviderOptionDescriptor.Type;

export const ProviderOptionDescriptor = Schema.Union([
  SelectProviderOptionDescriptor,
  BooleanProviderOptionDescriptor,
]);
export type ProviderOptionDescriptor = typeof ProviderOptionDescriptor.Type;

export const ProviderOptionSelectionValue = Schema.Union([TrimmedNonEmptyString, Schema.Boolean]);
export type ProviderOptionSelectionValue = typeof ProviderOptionSelectionValue.Type;

export const ProviderOptionSelection = Schema.Struct({
  id: TrimmedNonEmptyString,
  value: ProviderOptionSelectionValue,
});
export type ProviderOptionSelection = typeof ProviderOptionSelection.Type;

/**
 * Legacy on-disk shape for provider option selections, kept readable by the
 * decoder so we can tolerate stored data written before the v3 array shape.
 *
 * Persisted historically as `{ effort: "max", fastMode: true, ... }` inside
 * `modelSelection.options`. Migration 026 rewrites stored rows to the
 * canonical array shape, but we still see the legacy form in:
 *   - `settings.json` files from older client builds,
 *   - SQLite databases that have not yet run migration 026,
 *   - any future regression that re-introduces the legacy shape.
 */
const LegacyProviderOptionSelectionsObject = Schema.Record(Schema.String, Schema.Unknown);

const ProviderOptionSelectionsFromLegacyObject = LegacyProviderOptionSelectionsObject.pipe(
  Schema.decodeTo(
    Schema.Array(ProviderOptionSelection),
    SchemaTransformation.transformOrFail({
      decode: (record) => Effect.succeed(coerceLegacyOptionsObjectToArray(record)),
      encode: (selections) => Effect.succeed(canonicalSelectionsToLegacyObject(selections)),
    }),
  ),
);

/**
 * Schema for the `options` field of every `ModelSelection` variant.
 *
 * Accepts both:
 *   - the canonical array shape `Array<{ id, value }>` (preferred), and
 *   - the legacy object shape `Record<string, string | boolean | …>` from
 *     pre-migration data.
 *
 * Always normalizes to the canonical array on decode and re-encodes as the
 * canonical array, so any legacy storage gets cleaned up the next time the
 * containing record is written back.
 */
export const ProviderOptionSelections = Schema.Union([
  Schema.Array(ProviderOptionSelection),
  ProviderOptionSelectionsFromLegacyObject,
]);
export type ProviderOptionSelections = typeof ProviderOptionSelections.Type;

function coerceLegacyOptionsObjectToArray(
  record: Record<string, unknown>,
): ReadonlyArray<ProviderOptionSelection> {
  const entries: Array<ProviderOptionSelection> = [];
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const id = typeof rawKey === "string" ? rawKey.trim() : "";
    if (id.length === 0) continue;
    if (typeof rawValue === "string") {
      const trimmed = rawValue.trim();
      if (trimmed.length > 0) entries.push({ id, value: trimmed });
    } else if (typeof rawValue === "boolean") {
      entries.push({ id, value: rawValue });
    }
    // Drop anything else (numbers, null, nested objects/arrays) to match the
    // permissive normalization performed by migration 026.
  }
  return entries;
}

function canonicalSelectionsToLegacyObject(
  selections: ReadonlyArray<ProviderOptionSelection>,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const { id, value } of selections) {
    out[id] = value;
  }
  return out;
}

export const ModelCapabilities = Schema.Struct({
  optionDescriptors: Schema.optional(Schema.Array(ProviderOptionDescriptor)),
});
export type ModelCapabilities = typeof ModelCapabilities.Type;

const CODEX_DRIVER_KIND = ProviderDriverKind.make("codex");
const CLAUDE_DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
const CURSOR_DRIVER_KIND = ProviderDriverKind.make("cursor");
const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");
const OPENCODE_DRIVER_KIND = ProviderDriverKind.make("opencode");
const FREEBUFF_DRIVER_KIND = ProviderDriverKind.make("freebuff");

/**
 * Freebuff's free tier is pinned server-side to one model
 * (`FREEBUFF_FREE_MODEL` in the server adapter — currently
 * z-ai/glm-5.3-flash). Contracts cannot import from apps, so this
 * default mirrors that pin and must move with it.
 *
 * Moved from deepseek/deepseek-v4-flash to match upstream's 2026-08-30
 * default change (unpinned again 2026-09-05): GLM 5.3 Flash is the unmetered
 * (`premium: false`) row — a new user's first send cannot exhaust a pool —
 * open at every hour, and measured production spend puts V4 Flash at 8.9x
 * its cost per message. The old default's DeepSeek lane also carries
 * peak/off-peak pricing windows, which a default should never impose.
 */
export const DEFAULT_FREEBUFF_FREE_MODEL = "z-ai/glm-5.3-flash";

export const DEFAULT_MODEL = "gpt-5.6-sol";

/**
 * Codex default-model preference, most preferred first. The provider snapshot
 * marks the first of these present in the live `model/list` response as
 * default; when none are available, Codex's own `isDefault` flag wins.
 */
export const PREFERRED_DEFAULT_CODEX_MODELS: ReadonlyArray<string> = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
];
export const DEFAULT_TEXT_GENERATION_MODEL = "gpt-5.6-luna";
export const DEFAULT_TEXT_GENERATION_REASONING_EFFORT = "low";

export const DEFAULT_MODEL_BY_PROVIDER: Partial<Record<ProviderDriverKind, string>> = {
  [CODEX_DRIVER_KIND]: DEFAULT_MODEL,
  [CLAUDE_DRIVER_KIND]: "claude-sonnet-5",
  [CURSOR_DRIVER_KIND]: "auto",
  [GROK_DRIVER_KIND]: "grok-build",
  [OPENCODE_DRIVER_KIND]: "openai/gpt-5",
  [FREEBUFF_DRIVER_KIND]: DEFAULT_FREEBUFF_FREE_MODEL,
};

/**
 * The free-mode agent pairing table — one base3 root agent id per selectable
 * free-tier model, mirrored verbatim from upstream
 * (`common/src/constants/free-agents.ts` `FREEBUFF_WEB_BASE3_AGENT_ID_BY_MODEL`,
 * the live picker roster as of 2026-09-22). The backend's free-mode allowlist
 * rejects any model whose paired agent id is not sent with the request
 * (`free_mode_invalid_agent_model`), so a model may only be requested through
 * its row here. Models outside the map resolve to the default's root
 * (`base3-free-glm-5-3-flash`), which itself rejects unknown models
 * server-side — fail-closed.
 *
 * Roster reconciliation (#137), upstream-evidenced:
 *  - WITHDRAWN from free mode, 2026-08-20 → 2026-09-07, per
 *    `FREEBUFF_PAUSED_FREE_MODEL_IDS`: deepseek-v4-pro (cost), minimax-m3
 *    (cost), stealth/ox-alpha (host ended the free promotion), z-ai/glm-5.2
 *    (reward pool moved to GLM 5.3 Flash), muse-spark-1.3 (404 model_not_found
 *    on every key). Their rows are dropped here; picks of them coerce to the
 *    default's root below, the upstream #1801 doctrine — a refused id is the
 *    retry loop that cost the limited tier 2.5x its admissions.
 *  - google/gemini-3.8-flash returned 2026-09-04 BEHIND the subscription
 *    paywall (web-only Pro row) — not free-tier selectable.
 *  - crof/kimi-k3-eco and openai/gpt-5.6-luna-es are upstream
 *    `FREEBUFF_WEB_GOD_ONLY_MODELS` (`premium: true`) — never normal-picker
 *    rows, so the 4 priced models missing from the picker were not picker
 *    material at all.
 *  - meta/muse-spark-1.2-contributor REPLACED 1.3 on 2026-09-07 on every
 *    surface (answered 5/5 in the probe that killed 1.3) and carries the
 *    AI-training disclosure pair (`dataUse: 'training'`).
 *  - mimo/mimo-v2.5 is live (upstream `FREEBUFF_ENABLE_MIMO_MODELS_IN_UI` is
 *    true).
 *
 * Paired with `FREEBUFF_FREE_MODEL_IDS` (picker enumeration) and
 * `resolveFreebuffAgentForModel` (request derivation).
 */
export const FREEBUFF_FREE_AGENT_BY_MODEL: Readonly<Record<string, string>> = {
  "z-ai/glm-5.3-flash": "base3-free-glm-5-3-flash",
  "deepseek/deepseek-v4-flash": "base3-free-deepseek-flash",
  "openai/gpt-5.6-luna": "base3-free-luna",
  "mimo/mimo-v2.5": "base3-free-mimo",
  "upstage/solar-pro4": "base3-free-solar-pro4",
  "meta/muse-spark-1.2-contributor": "base3-free-muse-spark",
};

/** Every selectable free-tier model id (the picker's row set). */
export const FREEBUFF_FREE_MODEL_IDS: ReadonlyArray<string> = Object.keys(
  FREEBUFF_FREE_AGENT_BY_MODEL,
);

/**
 * Free rows whose supplier trains on the prompts and completions sent
 * through them — upstream carries this as the catalog's
 * `dataUse: 'training'` flag plus `FREEBUFF_AI_TRAINING_NOTICE` (2026-09-22
 * snapshot: the Muse Spark Contributor rows). The discount IS the training
 * grant, so a picker that offers the row must gate first use behind an
 * explicit consent. Upstream's own trace-retention policy for these rows is
 * "do not keep copies" — the disclosure is about the supplier's grant, not
 * our storage.
 */
export const FREEBUFF_TRAINING_DATA_MODEL_SLUGS: ReadonlySet<string> = new Set([
  "meta/muse-spark-1.2-contributor",
]);

/**
 * The base3 agent id to admit a session with for the requested model.
 * Unknown or absent models fall back to the flash root (the tier's default),
 * mirroring upstream's "resolve to the fallback model's root" rule.
 */
export function resolveFreebuffAgentForModel(model: string | undefined): string {
  if (model !== undefined) {
    const agentId = FREEBUFF_FREE_AGENT_BY_MODEL[model];
    if (agentId !== undefined) {
      return agentId;
    }
  }
  return FREEBUFF_FREE_AGENT_BY_MODEL[DEFAULT_FREEBUFF_FREE_MODEL] as string;
}

/** Per-provider text generation model defaults. */
export const DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, string>
> = {
  [CODEX_DRIVER_KIND]: DEFAULT_TEXT_GENERATION_MODEL,
  [CLAUDE_DRIVER_KIND]: "claude-haiku-4-5",
  [CURSOR_DRIVER_KIND]: "composer-2",
  [OPENCODE_DRIVER_KIND]: "openai/gpt-5",
};

export const MODEL_SLUG_ALIASES_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, Record<string, string>>
> = {
  [CODEX_DRIVER_KIND]: {
    "gpt-5-codex": "gpt-5.4",
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  [CLAUDE_DRIVER_KIND]: {
    opus: "claude-opus-5",
    "opus-5": "claude-opus-5",
    "claude-opus-5.0": "claude-opus-5",
    "claude-opus-5-0": "claude-opus-5",
    "opus-4.8": "claude-opus-4-8",
    "claude-opus-4.8": "claude-opus-4-8",
    "opus-4.7": "claude-opus-4-7",
    "claude-opus-4.7": "claude-opus-4-7",
    "opus-4.6": "claude-opus-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-opus-4-6-20251117": "claude-opus-4-6",
    sonnet: "claude-sonnet-5",
    "sonnet-5": "claude-sonnet-5",
    "claude-sonnet-5.0": "claude-sonnet-5",
    "claude-sonnet-5-0": "claude-sonnet-5",
    "sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  },
  [CURSOR_DRIVER_KIND]: {
    composer: "composer-2",
    "composer-1.5": "composer-1.5",
    "composer-1": "composer-1.5",
    "opus-4.6-thinking": "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    "sonnet-4.6-thinking": "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "opus-4.5-thinking": "claude-opus-4-5",
    "opus-4.5": "claude-opus-4-5",
  },
  [OPENCODE_DRIVER_KIND]: {},
};

// ── Provider display names ────────────────────────────────────────────

export const PROVIDER_DISPLAY_NAMES: Partial<Record<ProviderDriverKind, string>> = {
  [CODEX_DRIVER_KIND]: "Codex",
  [CLAUDE_DRIVER_KIND]: "Claude",
  [CURSOR_DRIVER_KIND]: "Cursor",
  [GROK_DRIVER_KIND]: "Grok",
  [OPENCODE_DRIVER_KIND]: "OpenCode",
};
