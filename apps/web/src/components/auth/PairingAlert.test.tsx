import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { PairingAlert, PairingStatus, busyAttribute } from "./PairingAlert";

describe("PairingAlert", () => {
  it("renders nothing without a message", () => {
    expect(renderToStaticMarkup(<PairingAlert message={null} />)).toBe("");
  });

  it("renders a role=alert region so assistive tech announces failures", () => {
    const html = renderToStaticMarkup(
      <PairingAlert message="Pairing token rejected." />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Pairing token rejected.");
  });

  it("keeps the house destructive styling contract", () => {
    const html = renderToStaticMarkup(
      <PairingAlert message="Expired token." />,
    );
    expect(html).toContain("border-destructive/30");
  });
});

describe("PairingStatus", () => {
  it("renders nothing without a message", () => {
    expect(renderToStaticMarkup(<PairingStatus message={null} />)).toBe("");
  });

  it("renders a polite status region so progress is announced", () => {
    const html = renderToStaticMarkup(
      <PairingStatus message="Connecting to this backend." />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Connecting to this backend.");
  });
});

describe("busyAttribute", () => {
  it("marks controls busy only while a submission is in flight", () => {
    expect(busyAttribute(true)).toMatchObject({ "aria-busy": "true" });
    expect(busyAttribute(false)).toMatchObject({ "aria-busy": "false" });
  });
});
