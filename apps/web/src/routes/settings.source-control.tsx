import { createFileRoute } from "@tanstack/react-router";

import { appRouteHead } from "./appHeads";

import { SourceControlSettingsPanel } from "../components/settings/SourceControlSettings";

export const Route = createFileRoute("/settings/source-control")({
  head: () => appRouteHead("source-control"),
  component: SourceControlSettingsPanel,
});
