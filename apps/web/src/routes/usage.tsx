import { createFileRoute } from "@tanstack/react-router";

import { appRouteHead } from "./appHeads";

import { UsagePage } from "../components/usage/UsagePage";

export const Route = createFileRoute("/usage")({
  head: () => appRouteHead("usage"),
  component: UsagePage,
});
