import { describe, expect, it } from "vite-plus/test";

import { APP_DISPLAY_NAME } from "../branding";
import { appRouteHead, appRouteHeads } from "./appHeads";

const LEAF_KEYS = [
  "appearance",
  "archived",
  "connections",
  "diagnostics",
  "general",
  "keybindings",
  "providers",
  "source-control",
  "usage",
  "projects",
] as const;

describe("appRouteHeads data", () => {
  it("covers every app-internal leaf route", () => {
    for (const key of LEAF_KEYS) {
      expect(appRouteHeads[key], `missing head entry: ${key}`).toBeDefined();
    }
  });

  it("formats titles as '<Section> — OpenBuff' with honest descriptions", () => {
    const titles = new Set<string>();
    for (const key of LEAF_KEYS) {
      const { meta } = appRouteHead(key);
      const title = meta.find((m) => m.name === "title");
      const description = meta.find((m) => m.name === "description");
      expect(title?.content, key).toBe(`${appRouteHeads[key].title} — ${APP_DISPLAY_NAME}`);
      expect(String(description?.content).length, key).toBeGreaterThanOrEqual(15);
      titles.add(String(title?.content));
    }
    expect(titles.size).toBe(LEAF_KEYS.length);
  });

  it("ships no og tags on auth-gated internal routes", () => {
    for (const key of LEAF_KEYS) {
      const { meta } = appRouteHead(key);
      expect(
        meta.some((m) => "property" in m && String(m.property).startsWith("og:")),
        key,
      ).toBe(false);
    }
  });

  it("uses no words on the unslop list", () => {
    const text = Object.values(appRouteHeads)
      .map((e) => `${e.title} ${e.description}`)
      .join(" ")
      .toLowerCase();
    const slop = [
      "supercharge",
      "unleash",
      "seamless",
      "blazing",
      "revolutionize",
      "game-changer",
      "effortless",
      "empower",
      "elevate",
    ];
    for (const word of slop) {
      expect(text).not.toContain(word);
    }
  });
});

describe("appRouteHeads wiring", () => {
  it("wires head into every settings leaf route", async () => {
    const routes = await Promise.all([
      import("./settings.appearance"),
      import("./settings.archived"),
      import("./settings.connections"),
      import("./settings.diagnostics"),
      import("./settings.general"),
      import("./settings.keybindings"),
      import("./settings.providers"),
      import("./settings.source-control"),
    ]);
    for (const mod of routes) {
      expect(typeof mod.Route.options.head, mod.Route.id).toBe("function");
    }
  });

  it("wires head into usage and projects routes", async () => {
    const usage = await import("./usage");
    const projects = await import("./projects.$projectKey");
    expect(typeof usage.Route.options.head).toBe("function");
    expect(typeof projects.Route.options.head).toBe("function");
  });
});
