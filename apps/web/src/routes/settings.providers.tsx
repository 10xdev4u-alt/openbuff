import { createFileRoute } from "@tanstack/react-router";

import { appRouteHead } from "./appHeads";

import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel";

function SettingsProvidersRoute() {
  return <ProviderSettingsPanel />;
}

export const Route = createFileRoute("/settings/providers")({
  head: () => appRouteHead("providers"),
  component: SettingsProvidersRoute,
});
