import { assert, it } from "@effect/vitest";

import { formatServiceStatus } from "./service.ts";

const status = {
  supported: true,
  installed: true,
  current: true,
  legacyInstalled: false,
  legacyUnitPath: "/home/me/.config/systemd/user/t3code.service",
  unitPath: "/home/me/.config/systemd/user/openbuff.service",
  logPath: "/home/me/.openbuff/userdata/logs/boot-service.log",
} as const;

it("reports the installed service version and host paths", () => {
  assert.equal(
    formatServiceStatus(status, "0.0.29"),
    [
      "OpenBuff service",
      "  Status: installed · @princetheprogrammerbtw/openbuff@0.0.29",
      "  Unit: /home/me/.config/systemd/user/openbuff.service",
      "  Logs: /home/me/.openbuff/userdata/logs/boot-service.log",
    ].join("\n"),
  );
});

it("gives a direct repair command for a stale service", () => {
  assert.include(
    formatServiceStatus({ ...status, current: false }, "0.0.29"),
    "Next: Run `npx @princetheprogrammerbtw/openbuff@latest service update`.",
  );
});

it("points t3-era operators at the migration when only the legacy unit exists", () => {
  assert.equal(
    formatServiceStatus(
      { ...status, installed: false, current: false, legacyInstalled: true },
      "0.0.29",
    ),
    [
      "OpenBuff service",
      "  Status: legacy t3code service detected",
      "  Unit: /home/me/.config/systemd/user/t3code.service",
      "  Logs: /home/me/.openbuff/userdata/logs/boot-service.log",
      "  Next: Run `openbuff service install` to migrate it.",
    ].join("\n"),
  );
});

it("flags residue when a legacy unit survives beside the installed one", () => {
  assert.include(
    formatServiceStatus({ ...status, legacyInstalled: true }, "0.0.29"),
    "Legacy t3code.service also present",
  );
  assert.include(
    formatServiceStatus({ ...status, legacyInstalled: true }, "0.0.29"),
    "`openbuff service uninstall`",
  );
});

it("explains service availability without systemd", () => {
  assert.include(
    formatServiceStatus({ ...status, supported: false, installed: false }, "0.0.29"),
    "Supported on: Linux with systemd",
  );
});
