import { createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const OpenBuffLanding = lazy(() =>
  import("../components/landing/OpenBuffLanding").then((m) => ({ default: m.OpenBuffLanding })),
);

/**
 * Document-head metadata for the landing (issue #72). Copy mirrors the README's
 * own description of the product — no invented claims. og:image is deliberately
 * absent until a real preview asset exists; a 404 image is worse than none.
 */
export const welcomeHead = () => ({
  meta: [
    { name: "title", content: "OpenBuff — the open web app for Freebuff" },
    {
      name: "description",
      content:
        "A local-first, ad-free web experience for the Freebuff AI coding agent, running on your machine.",
    },
    { property: "og:title", content: "OpenBuff — the open web app for Freebuff" },
    {
      property: "og:description",
      content:
        "A local-first, ad-free web experience for the Freebuff AI coding agent, running on your machine.",
    },
    { property: "og:type", content: "website" },
  ],
});

/**
 * Public landing for logged-out visitors of a local server (issue #33). The
 * `_chat` layout redirects the index route here when the auth gate has not
 * cleared; authenticated visitors bounce back to `/`.
 *
 * @module routes/welcome
 */
export const Route = createFileRoute("/welcome")({
  head: welcomeHead,
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
