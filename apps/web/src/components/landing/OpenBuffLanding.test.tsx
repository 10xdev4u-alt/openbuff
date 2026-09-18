import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { welcomeHead } from "../../routes/welcome";
import { OpenBuffLanding } from "./OpenBuffLanding";

/**
 * Head metadata (issue #72) is asserted as pure route data — renderToStaticMarkup
 * cannot observe TanStack's document-head layer, so the data contract is the seam.
 */
describe("welcomeHead", () => {
  it("titles the page for the product", () => {
    const meta = welcomeHead().meta ?? [];
    // { title } descriptor (not name:"title") is what the router renders as
    // a real <title> element.
    const title = meta.find((m) => "title" in m || ("property" in m && m.property === "og:title"));
    expect(meta.some((m) => "title" in m && String(m.title).includes("OpenBuff"))).toBe(true);
    expect(title).toBeDefined();
  });

  it("carries an honest description and og tags", () => {
    const meta = welcomeHead().meta ?? [];
    const find = (key: string) =>
      meta.find((m) => ("name" in m && m.name === key) || ("property" in m && m.property === key));
    const description = find("description");
    expect(String(description?.content)).toContain("Freebuff");
    expect(String(description?.content).length).toBeGreaterThan(0);
    expect(String(find("og:title")?.content)).toContain("OpenBuff");
    expect(String(find("og:description")?.content)).toContain("Freebuff");
    expect(find("og:type")?.content).toBe("website");
    expect(find("og:title")).toBeDefined();
    expect(find("og:description")).toBeDefined();
    expect(find("og:type")).toBeDefined();
    // og:image points at the real bundled asset. Root-relative on purpose: this
    // app has no fixed production origin, and an absolute guess would 404.
    expect(find("og:image")?.content).toBe("/og.png");
  });

  it("uses no words on the unslop list", () => {
    const meta = welcomeHead().meta ?? [];
    const text = meta
      .map((m) => m.content)
      .join(" ")
      .toLowerCase();
    for (const word of ["revolutionize", "game-changing", "fast-paced", "blazing", "seamless"]) {
      expect(text).not.toContain(word);
    }
  });
});

describe("OpenBuffLanding", () => {
  it("renders the Bodoni hero headline and a concrete subhead", () => {
    const markup = renderToStaticMarkup(<OpenBuffLanding />);
    expect(markup).toContain("Your agents, your machine.");
    expect(markup).toContain("local server");
  });

  it("shows the one-command start with the real bin name", () => {
    const markup = renderToStaticMarkup(<OpenBuffLanding />);
    expect(markup).toContain("npx openbuff@latest");
    expect(markup).toContain("Copy command");
  });

  it("states the real prerequisites with a docs link", () => {
    const markup = renderToStaticMarkup(<OpenBuffLanding />);
    // Static markup HTML-escapes `>=` inside JSX text, hence the entity form.
    expect(markup).toContain("^22.16 || ^23.11 || &gt;=24.10");
    expect(markup.toLowerCase()).toContain("freebuff login");
    expect(markup).toContain(
      'href="https://github.com/10xdev4u-alt/openbuff/blob/main/docs/user/install.md"',
    );
  });

  it("carries exactly the three substantive facts", () => {
    const markup = renderToStaticMarkup(<OpenBuffLanding />);
    expect(markup).toContain("One provider, in-process");
    expect(markup).toContain("Your browser, your machine");
    expect(markup).toContain("Approvals stay inline");
  });

  it("credits the design and upstream lineage honestly", () => {
    const markup = renderToStaticMarkup(<OpenBuffLanding />);
    expect(markup).toContain("Material 3 Expressive");
    expect(markup).toContain("rjwarrier/yata");
    expect(markup).toContain("pingdotgg/t3code");
  });

  it("passes the unslop checklist", () => {
    const markup = renderToStaticMarkup(<OpenBuffLanding />).toLowerCase();
    for (const word of [
      "seamless",
      "robust",
      "cutting-edge",
      "unleash",
      "supercharge",
      "delve",
      "elevate",
      "game-changing",
      "fast-paced",
      "revolutionize",
    ]) {
      expect(markup).not.toContain(word);
    }
  });
});
