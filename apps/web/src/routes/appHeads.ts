import { APP_DISPLAY_NAME } from "../branding";

/**
 * Head metadata for the app-internal routes (issue #87).
 *
 * Every authed tab previously inherited the root's generic title, making
 * multiple tabs indistinguishable. Titles follow `"<Section> — OpenBuff"`;
 * descriptions are one honest sentence mirroring what each panel actually
 * contains.
 *
 * og: tags are deliberately OMITTED here: these routes are auth-gated app
 * pages, never shared socially — unlike /welcome and /pair, which are the
 * visitor-facing surfaces. See pair.tsx for the opposite decision's reasoning.
 */

interface AppRouteHeadEntry {
  readonly title: string;
  readonly description: string;
}

export const appRouteHeads = {
  appearance: {
    title: "Appearance",
    description: "Themes, fonts, and interface text sizes.",
  },
  archived: {
    title: "Archived threads",
    description: "Browse and restore archived conversations.",
  },
  connections: {
    title: "Connections",
    description: "Pair browsers, manage saved environments and sessions.",
  },
  diagnostics: {
    title: "Diagnostics",
    description: "Inspect trace records and share them for bug reports.",
  },
  general: {
    title: "General",
    description: "Updates, background activity, and core preferences.",
  },
  keybindings: {
    title: "Keybindings",
    description: "Search and rebind keyboard shortcuts.",
  },
  providers: {
    title: "Providers",
    description: "Configure model providers and their instances.",
  },
  "source-control": {
    title: "Source control",
    description: "Account status and git integration visibility.",
  },
  usage: {
    title: "Usage",
    description: "Token costs and request counts per provider.",
  },
  projects: {
    title: "Projects",
    description: "Per-project settings and permissions.",
  },
} satisfies Record<string, AppRouteHeadEntry>;

export type AppRouteHeadKey = keyof typeof appRouteHeads;

export function appRouteHead(key: AppRouteHeadKey) {
  const entry = appRouteHeads[key];
  return {
    meta: [
      // { title } descriptor, not name:"title" — see __root.tsx for why.
      { title: `${entry.title} — ${APP_DISPLAY_NAME}` },
      { name: "description", content: entry.description },
    ],
  };
}
