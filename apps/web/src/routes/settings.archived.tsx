import { createFileRoute } from "@tanstack/react-router";

import { appRouteHead } from "./appHeads";

import { ArchivedThreadsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/archived")({
  head: () => appRouteHead("archived"),
  component: ArchivedThreadsPanel,
});
