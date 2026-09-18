import { createFileRoute } from "@tanstack/react-router";

import { appRouteHead } from "./appHeads";

import { GeneralSettingsPanel } from "../components/settings/SettingsPanels";

function SettingsGeneralRoute() {
  return <GeneralSettingsPanel />;
}

export const Route = createFileRoute("/settings/general")({
  head: () => appRouteHead("general"),
  component: SettingsGeneralRoute,
});
