import { createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const OpenBuffLanding = lazy(() =>
  import("../components/landing/OpenBuffLanding").then((m) => ({ default: m.OpenBuffLanding })),
);

/**
 * Document-head metadata for the landing (issues #72, #75). Copy mirrors the
 * README's own description of the product — no invented claims. og:image is
 * root-relative on purpose: this app has no fixed production origin, and an
 * absolute guess would 404. Asset + generator: apps/web/public/og.png,
 * scripts/generate-og-image.mjs.
 */
export const welcomeHead = () => ({
  meta: [
    // { title } descriptor, not name:"title" — see __root.tsx for why.
    { title: "OpenBuff — the open web app for Freebuff" },
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
    { property: "og:image", content: "/og.png" },
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
