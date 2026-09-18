import { describe, expect, it } from "vite-plus/test";

import { pairHead } from "./pair";

function findMeta(
  meta: ReadonlyArray<Record<string, unknown>>,
  key: string,
): Record<string, unknown> | undefined {
  return meta.find((m) => m.name === key || m.property === key);
}

describe("pairHead", () => {
  it("titles the page for pairing", () => {
    const meta = pairHead().meta ?? [];
    const title = findMeta(meta, "title");
    expect(title).toBeDefined();
    expect(String(title?.content)).toContain("OpenBuff");
    expect(String(title?.content).toLowerCase()).toContain("pair");
  });

  it("carries an honest description and og tags", () => {
    const meta = pairHead().meta ?? [];
    const find = (key: string) => findMeta(meta, key);
    const description = find("description");
    expect(description).toBeDefined();
    expect(String(description?.content)).toContain("pair");
    expect(find("og:title")).toBeDefined();
    expect(find("og:description")).toBeDefined();
    expect(find("og:type")?.content).toBe("website");
  });

  it("uses no words on the unslop list", () => {
    const meta = pairHead().meta ?? [];
    const text = meta
      .map((m) => String(m.content ?? ""))
      .join(" ")
      .toLowerCase();
    const slop = [
      "supercharge",
      "unleash",
      "seamless",
      "blazing",
      "revolutionize",
      "game-changer",
      "effortless",
      "empower",
      "elevate",
    ];
    for (const word of slop) {
      expect(text).not.toContain(word);
    }
  });
});
