import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ServerConfig,
  ServerProvider,
  ServerProviders,
  ServerUpsertKeybindingResult,
} from "./server.ts";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);
const decodeServerProviders = Schema.decodeUnknownSync(ServerProviders);
const decodeUpsertKeybindingResult = Schema.decodeUnknownSync(ServerUpsertKeybindingResult);
const decodeAvailableEditors = Schema.decodeUnknownSync(ServerConfig.fields.availableEditors);

const baseProviderSnapshot = {
  instanceId: "codex",
  driver: "codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  models: [],
};

describe("ServerProvider", () => {
  it("defaults capability arrays when decoding provider snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.slashCommands).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.versionAdvisory).toBeUndefined();
    expect(parsed.updateState).toBeUndefined();
  });

  it("decodes an optional freebuff usage block on a provider snapshot", () => {
    const parsed = decodeServerProvider({
      ...baseProviderSnapshot,
      driver: "freebuff",
      instanceId: "freebuff",
      usage: {
        rateLimitsByModel: {
          "deepseek/deepseek-v4-pro": {
            pool: "premium-day",
            poolLabel: "Premium sessions",
            period: "pacific_day",
            resetTimeZone: "America/Los_Angeles",
            resetAt: "2026-09-17T07:00:00.000Z",
            limit: 5,
            recentCount: 2,
            windowHours: 24,
          },
        },
        freeWindows: {
          dayUsed: 1,
          dayLimit: 8,
          weekUsed: 3,
          weekLimit: 40,
          monthUsed: 9,
          monthLimit: 120,
          dayResetAt: "2026-09-17T07:00:00.000Z",
          monthResetAt: "2026-10-01T07:00:00.000Z",
        },
        freebucks: {
          quotaExempt: false,
          balance: 12.5,
          daily: {
            limit: 10,
            spent: 4,
            remaining: 6,
            resetAt: "2026-09-17T07:00:00.000Z",
            resetTimeZone: "America/Los_Angeles",
          },
          wallet: { balance: 6.5, monthlyBonus: 0 },
          planId: null,
          prices: { "openai/gpt-5.6-luna": 2 },
        },
      },
    });

    expect(parsed.usage?.freebucks?.balance).toBe(12.5);
    expect(parsed.usage?.rateLimitsByModel?.["deepseek/deepseek-v4-pro"]?.pool).toBe(
      "premium-day",
    );
    expect(parsed.usage?.freeWindows?.dayUsed).toBe(1);
  });

  it("keeps absent usage absent so legacy snapshots decode unchanged", () => {
    const parsed = decodeServerProvider(baseProviderSnapshot);
    expect(parsed.usage).toBeUndefined();
  });

  it("carries null freebucks through (clears stale balances, never undefined)", () => {
    const parsed = decodeServerProvider({
      ...baseProviderSnapshot,
      driver: "freebuff",
      instanceId: "freebuff",
      usage: { freebucks: null },
    });
    expect(parsed.usage?.freebucks).toBeNull();
    expect(parsed.usage?.rateLimitsByModel).toBeUndefined();
    expect(parsed.usage?.freeWindows).toBeUndefined();
  });

  it("defaults one-click update support when decoding older advisory snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
      versionAdvisory: {
        status: "behind_latest",
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        updateCommand: "npm install -g @openai/codex@latest",
        checkedAt: "2026-04-10T00:00:00.000Z",
        message: "Update available.",
      },
    });

    expect(parsed.versionAdvisory?.canUpdate).toBe(false);
  });

  it("decodes continuation group metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex_personal",
      driver: "codex",
      continuation: { groupKey: "codex:home:/Users/julius/.codex" },
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.continuation?.groupKey).toBe("codex:home:/Users/julius/.codex");
  });

  it("decodes optional legacy model metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          isLegacy: true,
          capabilities: null,
        },
      ],
    });

    expect(parsed.models[0]?.isLegacy).toBe(true);
  });
});

describe("server config forward compatibility", () => {
  it("drops config issues with kinds this build does not know", () => {
    const parsed = decodeUpsertKeybindingResult({
      keybindings: [],
      issues: [
        { kind: "keybindings.invalid-entry", message: "Bad entry", index: 2 },
        { kind: "keybindings.future-issue", message: "From a newer server" },
      ],
    });

    expect(parsed.issues).toEqual([
      { kind: "keybindings.invalid-entry", message: "Bad entry", index: 2 },
    ]);
  });

  it("drops editor ids this build does not know", () => {
    const parsed = decodeAvailableEditors(["zed", "some-future-editor", "vscode"]);

    expect(parsed).toEqual(["zed", "vscode"]);
  });

  // A provider status this build has never seen (a new ServerProviderState,
  // ServerProviderAuthStatus, etc. member) previously failed the whole
  // `providers` array, taking every other provider down with it and, since
  // `providers` sits inside `ServerConfig`, failing the whole config decode —
  // an older client would drop its connection over one provider it can't
  // render. Dropping just that element keeps every other provider working.
  it("drops providers this build cannot decode instead of failing the whole array", () => {
    const decodedBase = decodeServerProvider(baseProviderSnapshot);

    const parsed = decodeServerProviders([
      baseProviderSnapshot,
      { ...baseProviderSnapshot, instanceId: "future", status: "some-future-status" },
    ]);

    expect(parsed).toEqual([decodedBase]);
  });
});
