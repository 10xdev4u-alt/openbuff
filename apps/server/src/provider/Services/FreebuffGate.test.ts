/**
 * FreebuffGate — session gate classifier tests.
 *
 * Fixtures ported from the upstream gate contract (`.repos/freebuff/common/src/types/freebuff-session.ts`,
 * `FREEBUFF_GATE_CODES` / `getFreebuffGateCode`) and the reference client's
 * recovery policy (`cli/src/utils/error-handling.ts`, `cli/src/hooks/helpers/send-message.ts`).
 *
 * @module provider/Services/FreebuffGate
 */
import { describe, expect, it } from "vite-plus/test";

import {
  classifyFreebuffGate,
  freebuffGateDisposition,
  gateUserMessage,
  type FreebuffGateCode,
} from "./FreebuffGate.ts";

describe("classifyFreebuffGate", () => {
  it("classifies every documented gate code by its exact status pair", () => {
    const pairs: Array<[FreebuffGateCode, number]> = [
      ["waiting_room_required", 428],
      ["session_expired", 410],
      ["session_superseded", 409],
      ["session_model_mismatch", 409],
      ["session_limit_reached", 409],
      ["waiting_room_queued", 429],
      ["model_unavailable", 410],
    ];
    for (const [code, status] of pairs) {
      expect(classifyFreebuffGate({ error: code, statusCode: status })).toBe(code);
    }
  });

  it("rejects a known code paired with the wrong status", () => {
    // Status-only or code-only matching lets an unrelated upstream error
    // impersonate the gate — both halves must match.
    expect(classifyFreebuffGate({ error: "session_expired", statusCode: 409 })).toBeNull();
    expect(classifyFreebuffGate({ error: "session_superseded", statusCode: 500 })).toBeNull();
    expect(classifyFreebuffGate({ error: "model_unavailable", statusCode: 428 })).toBeNull();
  });

  it("rejects inherited names via own-property semantics", () => {
    // `in` would accept prototype names like toString and classify an error
    // carrying no statusCode as a gate rejection.
    expect(classifyFreebuffGate({ error: "toString", statusCode: undefined })).toBeNull();
    const hostile = Object.create({ session_expired: { status: 410 } }) as {
      error?: string;
      statusCode?: number;
    };
    hostile.error = "session_expired";
    expect(classifyFreebuffGate(hostile)).toBeNull();
  });

  it("requires a numeric status matching the table", () => {
    expect(classifyFreebuffGate({ error: "session_expired" })).toBeNull();
    expect(classifyFreebuffGate({ error: "session_expired", statusCode: "410" })).toBeNull();
  });

  it("returns null for non-objects, missing codes, and unknown codes", () => {
    expect(classifyFreebuffGate(null)).toBeNull();
    expect(classifyFreebuffGate(undefined)).toBeNull();
    expect(classifyFreebuffGate("session_expired")).toBeNull();
    expect(classifyFreebuffGate({})).toBeNull();
    expect(classifyFreebuffGate({ error: "some_other_error", statusCode: 410 })).toBeNull();
  });

  it("classifies from a thrown error carrying the pair on its surface", () => {
    const err = Object.assign(new Error("gate"), {
      error: "waiting_room_required",
      statusCode: 428,
    });
    expect(classifyFreebuffGate(err)).toBe("waiting_room_required");
  });
});

describe("freebuffGateDisposition", () => {
  it("maps session-ending seat codes to ended", () => {
    expect(freebuffGateDisposition("waiting_room_required")).toBe("ended");
    expect(freebuffGateDisposition("session_expired")).toBe("ended");
    expect(freebuffGateDisposition("session_model_mismatch")).toBe("ended");
  });

  it("maps superseded to the terminal takeover state", () => {
    expect(freebuffGateDisposition("session_superseded")).toBe("superseded");
  });

  it("maps transient and account-level codes to session-surviving states", () => {
    expect(freebuffGateDisposition("waiting_room_queued")).toBe("retry-transient");
    expect(freebuffGateDisposition("session_limit_reached")).toBe("account-limited");
    expect(freebuffGateDisposition("model_unavailable")).toBe("model-closed");
  });
});

describe("gateUserMessage", () => {
  it("gives every gate code an actionable, non-raw message", () => {
    const codes: Array<FreebuffGateCode | null> = [
      "waiting_room_required",
      "session_expired",
      "session_superseded",
      "session_model_mismatch",
      "session_limit_reached",
      "waiting_room_queued",
      "model_unavailable",
    ];
    for (const code of codes) {
      const message = gateUserMessage(code);
      expect(message).toBeTruthy();
      expect(message).not.toMatch(/4\d\d|statusCode/i);
    }
  });

  it("returns undefined for non-gate failures so raw errors flow unchanged", () => {
    expect(gateUserMessage(null)).toBeUndefined();
  });
});
