import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { OpenBuffLanding } from "./OpenBuffLanding";

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
