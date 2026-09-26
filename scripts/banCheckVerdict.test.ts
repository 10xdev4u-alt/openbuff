import { describe, expect, it } from "vite-plus/test";

import { classifyBanCheck } from "./banCheckVerdict.ts";

describe("classifyBanCheck", () => {
  it("reads a 200 as alive with the session surface reachable", () => {
    const v = classifyBanCheck(200, '{"status":"active"}');
    expect(v.verdict).toBe("alive");
    expect(v.detail).toMatch(/reachable/i);
  });

  it("reads the terminal banned body as still-banned", () => {
    const v = classifyBanCheck(403, '{"status":"banned"}');
    expect(v.verdict).toBe("banned");
    expect(v.detail).toMatch(/terminal/i);
  });

  it("never mistakes a 401 for a ban — expired token is its own verdict", () => {
    const v = classifyBanCheck(401, "unauthorized");
    expect(v.verdict).toBe("token-expired");
  });

  it("surfaces unexpected statuses without inventing a verdict", () => {
    expect(classifyBanCheck(500, "oops").verdict).toBe("unexpected");
    expect(classifyBanCheck(429, "slow down").verdict).toBe("unexpected");
  });

  it("treats a 403 WITHOUT the banned body as unexpected, not banned", () => {
    // The wire contract keys on the body status; a bare 403 is a different
    // animal and must be read, not pattern-matched into the ban verdict.
    const v = classifyBanCheck(403, "forbidden");
    expect(v.verdict).toBe("unexpected");
  });
});
