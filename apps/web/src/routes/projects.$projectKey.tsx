import { createFileRoute, redirect } from "@tanstack/react-router";

import { appRouteHead } from "./appHeads";

import { ProjectSettingsPage } from "../components/settings/ProjectSettingsPanel";

export const Route = createFileRoute("/projects/$projectKey")({
  head: () => appRouteHead("projects"),
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: () => <ProjectSettingsPage projectKey={Route.useParams().projectKey} />,
});
