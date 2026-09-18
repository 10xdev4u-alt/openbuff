import { createFileRoute } from "@tanstack/react-router";

import { appRouteHead } from "./appHeads";

import { AppearanceSettingsPanel } from "../components/settings/SettingsPanels";

function SettingsAppearanceRoute() {
  return <AppearanceSettingsPanel />;
}

export const Route = createFileRoute("/settings/appearance")({
  head: () => appRouteHead("appearance"),
  component: SettingsAppearanceRoute,
});
