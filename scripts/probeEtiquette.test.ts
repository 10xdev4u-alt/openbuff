import { describe, expect, it } from "vite-plus/test";

import {
  enforceProbeEtiquette,
  PROBE_PEAK_WINDOW_UTC,
  PROBE_SPACING_MS,
} from "./probeEtiquette.ts";

describe("enforceProbeEtiquette", () => {
  it("requires the minimum spacing between admissions", () => {
    const last = Date.parse("2026-09-26T10:00:00Z");
    const verdict = enforceProbeEtiquette({
      now: last + PROBE_SPACING_MS - 1,
      lastAdmissionAt: last,
      mode: "active",
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/spacing/i);

    const ok = enforceProbeEtiquette({
      now: last + PROBE_SPACING_MS,
      lastAdmissionAt: last,
      mode: "active",
    });
    expect(ok.allowed).toBe(true);
  });

  it("refuses the peak window outright (02:00-05:00 UTC) for active probes", () => {
    // Minutes inside the window, on both sides of midnight UTC.
    for (const iso of ["2026-09-26T02:00:30Z", "2026-09-26T04:59:00Z", "2026-09-27T03:30:00Z"]) {
      const verdict = enforceProbeEtiquette({
        now: Date.parse(iso),
        lastAdmissionAt: undefined,
        mode: "active",
      });
      expect(verdict.allowed, iso).toBe(false);
      expect(verdict.reason, iso).toMatch(/peak/i);
    }
  });

  it("serves the passive ban check regardless of window or spacing", () => {
    // The 09-26 02:50 web-search 200 proved the ACCOUNT stays reachable
    // during a ban; the passive GET must never be window-gated, or the
    // checker is useless exactly when it is needed.
    for (const iso of ["2026-09-26T02:00:30Z", "2026-09-26T04:59:00Z"]) {
      const verdict = enforceProbeEtiquette({
        now: Date.parse(iso),
        lastAdmissionAt: undefined,
        mode: "passive",
      });
      expect(verdict.allowed, iso).toBe(true);
    }
  });

  it("allows active probes outside the window with no history", () => {
    const verdict = enforceProbeEtiquette({
      now: Date.parse("2026-09-26T13:00:00Z"),
      lastAdmissionAt: undefined,
      mode: "active",
    });
    expect(verdict.allowed).toBe(true);
  });

  it("pins the etiquette constants to the runbook", () => {
    // docs/operations/probe-resumption.md: >=1h spacing, never 02:00-05:00 UTC.
    expect(PROBE_SPACING_MS).toBe(60 * 60 * 1000);
    expect(PROBE_PEAK_WINDOW_UTC).toEqual({ startHour: 2, endHour: 5 });
  });
});
