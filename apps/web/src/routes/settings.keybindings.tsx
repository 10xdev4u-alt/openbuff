import { createFileRoute } from "@tanstack/react-router";

import { appRouteHead } from "./appHeads";

import { KeybindingsSettingsPanel } from "../components/settings/KeybindingsSettings";

export const Route = createFileRoute("/settings/keybindings")({
  head: () => appRouteHead("keybindings"),
  component: KeybindingsSettingsPanel,
});
