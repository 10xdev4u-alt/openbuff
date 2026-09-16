import * as NodeNet from "node:net";

/**
 * Dev-server bind resolution for the web workspace.
 *
 * Node binds a *hostname* (e.g. `localhost`) to the FIRST address it resolves
 * — which is OS/DNS-order dependent, so `localhost` may answer only `[::1]`
 * or only `127.0.0.1`. No single hostname dual-binds. The wildcard addresses
 * are the dual option (`::` also accepts IPv4-mapped connections on Linux and
 * default macOS), but `::` requires IPv6 support at the kernel level.
 *
 * Resolution order:
 * 1. An explicit host always wins verbatim (desktop mode passes `127.0.0.1`;
 *    operators may pass `0.0.0.0`, a tailnet IP, etc. — not our call).
 * 2. Otherwise probe `::` and use it when IPv6 is available (dual-stack).
 * 3. Fall back to `0.0.0.0` when IPv6 is unavailable (v4-only machines).
 *
 * Known tradeoff (reviewed 2026-09-16, CodeRabbit #49): a kernel with IPv6
 * present but IPv4 absent — or hardened with `net.ipv6.bindv6only=1` — makes
 * `::` v6-only for clients. We keep `::` there anyway: `0.0.0.0` cannot bind
 * on a v4-less kernel, so a v4-connect side-probe (the suggested remedy) would
 * steer exactly those machines into an unbindable fallback and kill the dev
 * server. v6-only hosts stay served via `::`; the bindv6only=1 residue is
 * recorded here rather than papered over with a third probe tier.
 */

export const V6_WILDCARD_HOST = "::";
export const V4_WILDCARD_HOST = "0.0.0.0";

/** Minimal surface of a `node:net` server the probe needs — injectable so tests never depend on host IPv6. */
export type BindableServer = {
  once(event: "error", listener: (error: Error) => void): unknown;
  listen(options: { host: string; port: number }, callback: () => void): unknown;
  close(callback: () => void): unknown;
};

export type V6ProbeServerFactory = () => BindableServer;

export function resolveDevBindHost(
  explicitHost: string | undefined,
  supportsV6Wildcard: boolean,
): string {
  if (explicitHost !== undefined && explicitHost !== "") {
    return explicitHost;
  }
  return supportsV6Wildcard ? V6_WILDCARD_HOST : V4_WILDCARD_HOST;
}

/** Probe whether the kernel accepts an IPv6 wildcard bind. */
export function probeV6WildcardSupport(
  targetPort = 0,
  makeServer: V6ProbeServerFactory = () => new NodeNet.Server(),
): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = makeServer();
    probe.once("error", () => resolve(false));
    probe.listen({ host: V6_WILDCARD_HOST, port: targetPort }, () => {
      probe.close(() => resolve(true));
    });
  });
}
