import { describe, expect, it } from "vite-plus/test";

import { FREEBUFF_API_BASE, releaseFreebuffSession } from "./FreebuffSession.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The doubles satisfy the wire contract; Bun's fetch type carries extra members we never use. */
function asFetch(fn: (url: string | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return fn as unknown as typeof fetch;
}

describe("releaseFreebuffSession (DELETE /api/v1/freebuff/session)", () => {
  it("sends DELETE with bearer token and instance header", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await releaseFreebuffSession("tok-1", "inst-9", {
      fetch: asFetch(async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse(200, { status: "none" });
      }),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${FREEBUFF_API_BASE}/api/v1/freebuff/session`);
    expect(calls[0]?.init.method).toBe("DELETE");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok-1");
    expect(headers.get("x-freebuff-instance-id")).toBe("inst-9");
  });

  it("swallows network failures — release is best-effort, the sweep is the backstop", async () => {
    await expect(
      releaseFreebuffSession("tok-1", "inst-9", {
        fetch: asFetch(async () => {
          throw new TypeError("network down");
        }),
      }),
    ).resolves.toBeUndefined();
  });

  it("resolves on non-2xx responses without throwing", async () => {
    await expect(
      releaseFreebuffSession("tok-1", "inst-9", {
        fetch: asFetch(async () => jsonResponse(404, { status: "none" })),
      }),
    ).resolves.toBeUndefined();
  });
});
