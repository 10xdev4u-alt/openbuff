import { describe, expect, it } from "vite-plus/test";

import {
  formatModelUnavailableProse,
  type FreebuffSessionResponse,
} from "./FreebuffSession.ts";

/** The doubles satisfy the wire contract; Bun's fetch type carries extra members we never use. */
function asFetch(fn: (url: string | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return fn as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function admit(body: unknown, status = 409): Promise<FreebuffSessionResponse> {
  const { establishFreebuffSession } = await import("./FreebuffSession.ts");
  return establishFreebuffSession("tok", {
    fetch: asFetch(async () => jsonResponse(status, body)),
  });
}

describe("gate body passthrough", () => {
  it("model_locked carries current + requested models through admission", async () => {
    const res = await admit({
      status: "model_locked",
      currentModel: "z-ai/glm-5.3-flash",
      requestedModel: "deepseek/deepseek-v4-flash",
    });
    expect(res.status).toBe("model_locked");
    expect(res.currentModel).toBe("z-ai/glm-5.3-flash");
    expect(res.requestedModel).toBe("deepseek/deepseek-v4-flash");
  });

  it("model_unavailable carries prose floor and the computable instant", async () => {
    const res = await admit({
      status: "model_unavailable",
      requestedModel: "openai/gpt-5.6-luna",
      availableHours: "usually 09:00–17:00 UTC",
      availableAt: "2026-09-16T15:30:00.000Z",
      requiresSubscription: false,
    });
    expect(res.status).toBe("model_unavailable");
    expect(res.availableHours).toBe("usually 09:00–17:00 UTC");
    expect(res.availableAt).toBe("2026-09-16T15:30:00.000Z");
    expect(res.requiresSubscription).toBe(false);
  });
});

describe("formatModelUnavailableProse", () => {
  const NOW = Date.parse("2026-09-16T12:00:00.000Z");

  it("leads with the server prose floor verbatim", () => {
    const prose = formatModelUnavailableProse(
      { availableHours: "usually 09:00–17:00 UTC" },
      NOW,
    );
    expect(prose).toContain("usually 09:00–17:00 UTC");
  });

  it("appends the reader-local instant when the server provides one", () => {
    const prose = formatModelUnavailableProse(
      {
        availableHours: "usually 09:00–17:00 UTC",
        availableAt: "2026-09-16T15:30:00.000Z",
      },
      NOW,
    );
    expect(prose).toMatch(/back around \d{1,2}:\d{2}/);
  });

  it("does not invent a time when availableAt is absent (older servers)", () => {
    const prose = formatModelUnavailableProse(
      { availableHours: "usually 09:00–17:00 UTC" },
      NOW,
    );
    expect(prose).not.toContain("back around");
  });
});
