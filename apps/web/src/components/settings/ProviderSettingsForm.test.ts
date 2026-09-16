import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import { DRIVER_OPTION_BY_VALUE } from "./providerDriverMeta";
import {
  deriveProviderSettingsFields,
  nextProviderConfigWithFieldValue,
  readProviderConfigBoolean,
  readProviderConfigString,
} from "./ProviderSettingsForm";

describe("ProviderSettingsForm helpers", () => {
  it("derives visible provider config fields from the client definition schema", () => {
    const freebuff = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("freebuff")];

    expect(freebuff).toBeDefined();
    expect(deriveProviderSettingsFields(freebuff!).map((field) => field.key)).toEqual([
      "apiKey",
      "agent",
      "model",
    ]);
  });

  it("sources labels and descriptions from schema annotations", () => {
    const freebuff = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("freebuff")];
    expect(freebuff).toBeDefined();

    const apiKey = deriveProviderSettingsFields(freebuff!).find(
      (field) => field.key === "apiKey",
    );

    expect(apiKey).toMatchObject({
      label: "Auth token override",
      description: "Optional. Leave empty to reuse your Freebuff CLI login automatically.",
      control: "password",
    });
  });

  it("preserves unknown config keys while omitting empty configurable fields", () => {
    const freebuff = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("freebuff")];
    expect(freebuff).toBeDefined();

    const model = deriveProviderSettingsFields(freebuff!).find(
      (field) => field.key === "model",
    );
    expect(model).toBeDefined();

    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, model: "test/model-slug" },
      model!,
      "",
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("reads non-string config values as blank strings", () => {
    expect(readProviderConfigString({ binaryPath: 123 }, "binaryPath")).toBe("");
  });

  it("omits false boolean fields when clearWhenEmpty is omit", () => {
    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, experimental: true },
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: false,
      },
      false,
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("omits true boolean fields when true is the default", () => {
    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, experimental: false },
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: true,
      },
      true,
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("stores false boolean fields when true is the default", () => {
    const next = nextProviderConfigWithFieldValue(
      undefined,
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: true,
      },
      false,
    );

    expect(next).toEqual({ experimental: false });
  });

  it("preserves false boolean fields when clearWhenEmpty is persist", () => {
    const next = nextProviderConfigWithFieldValue(
      undefined,
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "persist",
      },
      false,
    );

    expect(next).toEqual({ experimental: false });
  });

  it("reads non-boolean config values as false booleans", () => {
    expect(readProviderConfigBoolean({ experimental: "true" }, "experimental")).toBe(false);
  });

  it("reads missing boolean config values from the supplied default", () => {
    expect(readProviderConfigBoolean({}, "experimental", true)).toBe(true);
  });
});
