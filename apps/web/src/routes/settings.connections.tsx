import { createFileRoute } from "@tanstack/react-router";

import { appRouteHead } from "./appHeads";

import { ConnectionsSettings } from "../components/settings/ConnectionsSettings";

export const Route = createFileRoute("/settings/connections")({
  head: () => appRouteHead("connections"),
  component: ConnectionsSettings,
});
