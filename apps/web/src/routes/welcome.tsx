import { createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const OpenBuffLanding = lazy(() =>
  import("../components/landing/OpenBuffLanding").then((m) => ({ default: m.OpenBuffLanding })),
);

/**
 * Public landing for logged-out visitors of a local server (issue #33). The
 * `_chat` layout redirects the index route here when the auth gate has not
 * cleared; authenticated visitors bounce back to `/`.
 *
 * @module routes/welcome
 */
export const Route = createFileRoute("/welcome")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status === "authenticated" ||
      context.authGateState.status === "hosted-static"
    ) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: WelcomeRouteView,
});

function WelcomeRouteView() {
  return (
    <Suspense fallback={null}>
      <OpenBuffLanding />
    </Suspense>
  );
}
