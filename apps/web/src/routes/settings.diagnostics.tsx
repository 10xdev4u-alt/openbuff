import { createFileRoute } from "@tanstack/react-router";

import { appRouteHead } from "./appHeads";

import { DiagnosticsSettingsPanel } from "../components/settings/DiagnosticsSettings";

export const Route = createFileRoute("/settings/diagnostics")({
  head: () => appRouteHead("diagnostics"),
  component: DiagnosticsSettingsPanel,
});
