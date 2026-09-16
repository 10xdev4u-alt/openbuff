import * as NodeNet from "node:net";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  probeV6WildcardSupport,
  resolveDevBindHost,
  V4_WILDCARD_HOST,
  V6_WILDCARD_HOST,
  type BindableServer,
  type V6ProbeServerFactory,
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

  /** Deterministic fake server: queued "events", recorded calls, no host dependency. */
  function makeFakeServer(): {
    server: BindableServer;
    emitError: (error: Error) => void;
    emitListen: () => void;
    calls: { host: string; port: number; closed: boolean };
  } {
    let errorHandler: ((error: Error) => void) | undefined;
    let listenCallback: (() => void) | undefined;
    const calls = { host: "", port: -1, closed: false };
    const server: BindableServer = {
      once(_event, listener) {
        errorHandler = listener;
        return this;
      },
      listen(options, callback) {
        calls.host = options.host;
        calls.port = options.port;
        listenCallback = callback;
        return this;
      },
      close(callback) {
        calls.closed = true;
        callback();
        return this;
      },
    };
    return {
      server,
      calls,
      emitError: (error) => errorHandler?.(error),
      emitListen: () => listenCallback?.(),
    };
  }

  function factoryOf(fake: ReturnType<typeof makeFakeServer>): V6ProbeServerFactory {
    return () => fake.server;
  }

  it("binds the v6 wildcard and resolves true on a successful listen", async () => {
    const fake = makeFakeServer();
    const pending = probeV6WildcardSupport(0, factoryOf(fake));

    fake.emitListen();
    await expect(pending).resolves.toBe(true);
    expect(fake.calls).toEqual({ host: V6_WILDCARD_HOST, port: 0, closed: true });
  });

  it("resolves false instead of rejecting when the wildcard bind errors", async () => {
    const fake = makeFakeServer();
    const pending = probeV6WildcardSupport(0, factoryOf(fake));

    fake.emitError(new Error("EAFNOSUPPORT: no ipv6"));
    await expect(pending).resolves.toBe(false);
  });

  it("aims the probe at the requested port", async () => {
    const fake = makeFakeServer();
    const pending = probeV6WildcardSupport(5899, factoryOf(fake));

    fake.emitListen();
    await expect(pending).resolves.toBe(true);
    expect(fake.calls.port).toBe(5899);
  });

  it("passes through when resolving is attempted against an erroring server", async () => {
    const fake = makeFakeServer();
    const pending = probeV6WildcardSupport(0, factoryOf(fake));

    fake.emitError(new Error("fail"));
    await expect(pending).resolves.toBe(false);
  });

  it("smoke: the real probe agrees with a direct real bind on this host", async () => {
    const result = await probeV6WildcardSupport();
    const direct = await new Promise<boolean>((resolve) => {
      const probe = new NodeNet.Server();
      probe.once("error", () => resolve(false));
      probe.listen({ host: V6_WILDCARD_HOST, port: 0 }, () => {
        probe.close(() => resolve(true));
      });
    });
    expect(result).toBe(direct);
  });
});
