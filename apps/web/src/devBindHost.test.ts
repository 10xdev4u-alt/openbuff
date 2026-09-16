import * as NodeNet from "node:net";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  probeV6WildcardSupport,
  resolveDevBindHost,
  V4_WILDCARD_HOST,
  V6_WILDCARD_HOST,
} from "./devBindHost.ts";

describe("resolveDevBindHost", () => {
  it("prefers the dual-stack v6 wildcard when supported and unconfigured", () => {
    expect(resolveDevBindHost(undefined, true)).toBe(V6_WILDCARD_HOST);
    expect(resolveDevBindHost("", true)).toBe(V6_WILDCARD_HOST);
  });

  it("falls back to the v4 wildcard when v6 is unavailable", () => {
    expect(resolveDevBindHost(undefined, false)).toBe(V4_WILDCARD_HOST);
    expect(resolveDevBindHost("", false)).toBe(V4_WILDCARD_HOST);
  });

  it("an explicit host always wins verbatim regardless of v6 support", () => {
    expect(resolveDevBindHost("127.0.0.1", true)).toBe("127.0.0.1");
    expect(resolveDevBindHost("127.0.0.1", false)).toBe("127.0.0.1");
    expect(resolveDevBindHost("0.0.0.0", true)).toBe("0.0.0.0");
    expect(resolveDevBindHost("::1", true)).toBe("::1");
    expect(resolveDevBindHost("100.64.0.1", true)).toBe("100.64.0.1");
  });

  it("never returns a bare hostname (no single hostname dual-binds)", () => {
    for (const v6 of [true, false]) {
      for (const explicit of [undefined, ""]) {
        const host = resolveDevBindHost(explicit, v6);
        expect(host.includes("localhost")).toBe(false);
        expect(host).toMatch(/^[0-9a-f.:]+$/);
      }
    }
  });
});

describe("probeV6WildcardSupport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports true when a v6 wildcard bind succeeds", async () => {
    const result = await probeV6WildcardSupport();
    // This machine either supports v6 or it does not; the probe must agree
    // with a direct bind attempt under the same conditions.
    const direct = await new Promise<boolean>((resolve) => {
      const probe = new NodeNet.Server();
      probe.once("error", () => resolve(false));
      probe.listen({ host: V6_WILDCARD_HOST, port: 0 }, () => {
        probe.close(() => resolve(true));
      });
    });
    expect(result).toBe(direct);
  });

  it("resolves false instead of rejecting when the wildcard bind fails", async () => {
    // Emulate bind failure by occupying a real wildcard port, then aiming the
    // probe's failure path at it. The holder gets an error listener — an
    // unhandled 'error' event kills the test process.
    const holder = await new Promise<NodeNet.Server>((resolve, reject) => {
      const server = new NodeNet.Server();
      server.once("error", reject);
      server.listen({ host: V6_WILDCARD_HOST, port: 0 }, () => {
        server.removeAllListeners("error");
        resolve(server);
      });
    });
    const heldPort = (holder.address() as NodeNet.AddressInfo).port;

    const occupiedProbe = await probeV6WildcardSupport(heldPort);
    expect(occupiedProbe).toBe(false);

    await new Promise<void>((resolve) => holder.close(() => resolve()));
  });
});
