import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

/**
 * Head metadata for the pairing route (issue #79).
 *
 * Remote visitors land here from shared pairing links, so this page needs the
 * same head treatment as /welcome. Copy mirrors what the page actually does —
 * a one-time token exchange — with no invented claims.
 *
 * og:image is deliberately INCLUDED (root-relative /og.png, same reasoning as
 * /welcome: this app has no fixed production origin, so an absolute URL would
 * 404). A bare IP:port link with no preview card reads as phishing; a branded
 * card tells the visitor the link belongs to a real OpenBuff instance. The
 * one-time token itself never appears in the card: it lives in the URL
 * fragment, which link previewers never fetch.
 */
export function pairHead() {
  return {
    meta: [
      // { title } descriptor, not name:"title" — see __root.tsx for why.
      { title: "OpenBuff — Pair with this environment" },
      {
        name: "description",
        content: "Pair this browser with an OpenBuff environment using a one-time pairing token.",
      },
      { property: "og:title", content: "OpenBuff — Pair with this environment" },
      {
        property: "og:description",
        content: "Pair this browser with an OpenBuff environment using a one-time pairing token.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/og.png" },
    ],
  };
}

import {
  HostedPairingRouteSurface,
  PairingPendingSurface,
  PairingRouteSurface,
} from "../components/auth/PairingRouteSurface";

export const Route = createFileRoute("/pair")({
  head: pairHead,
  beforeLoad: async ({ context }) => {
    const { authGateState } = context;
    if (authGateState.status === "hosted-pairing") {
      return {
        authGateState,
      };
    }

    if (authGateState.status === "authenticated" || authGateState.status === "hosted-static") {
      throw redirect({ to: "/", replace: true });
    }
    return {
      authGateState,
    };
  },
  component: PairRouteView,
  pendingComponent: PairRoutePendingView,
});

function PairRouteView() {
  const { authGateState } = Route.useRouteContext();
  const navigate = useNavigate();

  if (!authGateState) {
    return null;
  }

  if (authGateState.status === "hosted-pairing") {
    return <HostedPairingRouteSurface />;
  }

  return (
    <PairingRouteSurface
      auth={authGateState.auth}
      onAuthenticated={() => {
        void navigate({ to: "/", replace: true });
      }}
      {...(authGateState.errorMessage ? { initialErrorMessage: authGateState.errorMessage } : {})}
    />
  );
}

function PairRoutePendingView() {
  return <PairingPendingSurface />;
}
