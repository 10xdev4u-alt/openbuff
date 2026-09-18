/**
 * Regenerates apps/web/public/og.png — the /welcome social preview (issue #75).
 *
 * Design language is not invented here: fonts are the app's own self-hosted
 * Bodoni Moda + Inter Tight (apps/web/public/fonts/), colors are the app's
 * --m3-* tokens from apps/web/src/index.css converted to sRGB, and the copy
 * mirrors the landing/README. Run from the repo root:
 *
 *   node scripts/generate-og-image.mjs
 *
 * Toolchain (all local, none of it a repo dependency):
 *   npm i --prefix /tmp/oggen satori @resvg/resvg-js culori wawoff2
 *   python3 -m pip install --target /tmp/oggen/py fonttools
 *   NODE_PATH=/tmp/oggen/node_modules node scripts/generate-og-image.mjs
 *   (or `npm i --no-save` the four packages at the repo root)
 *
 * The repo ships WOFF2 *variable* fonts; satori needs static TTF outlines, so
 * wght/opsz are instanced here (Bodoni: wght=700 opsz=96, the display cut the
 * hero uses). If you change the landing's hero copy or tokens, regenerate.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

// The generator's toolchain is deliberately NOT a repo dependency (it exists
// to regenerate one committed asset). Resolve it from a local install;
// Node >=22 loads ESM-only packages through require().
const require = createRequire(import.meta.url);
const satoriModule = require("satori");
const satori = satoriModule.default ?? satoriModule;
const { Resvg } = require("@resvg/resvg-js");
const { oklch, formatRgb } = require("culori");
const { decompress } = require("wawoff2");

const ROOT = path.resolve(import.meta.dirname, "..");
const FONTS_DIR = path.join(ROOT, "apps/web/public/fonts");
const OUT = path.join(ROOT, "apps/web/public/og.png");
const TMP = fs.mkdtempSync("/tmp/oggen-");

const W = 1200;
const H = 630;

// --m3-* tokens, apps/web/src/index.css (~1278-1300). Converted, never invented.
const PRIMARY = formatRgb(oklch("oklch(0.58 0.15 55)")); // #BB5D00
const ON_PRIMARY = formatRgb(oklch("oklch(0.985 0.005 80)")); // #FCFAF6
const SURFACE = "#0B0A09"; // neutral-950 family, index.css:1158-1161

/** WOFF2 (possibly variable) → static TTF at the given axis pins. */
async function staticTtf(woff2Name, pins) {
  const src = path.join(FONTS_DIR, woff2Name);
  const woff2 = fs.readFileSync(src);
  const ttf = Buffer.from(await decompress(woff2));
  const rawPath = path.join(TMP, `raw-${path.basename(woff2Name, ".woff2")}.ttf`);
  fs.writeFileSync(rawPath, ttf);
  const outPath = rawPath.replace(/\.ttf$/, "-static.ttf");
  execFileSync("python3", ["-m", "fontTools.varLib.instancer", rawPath, ...pins, "-o", outPath], {
    env: { ...process.env, PYTHONPATH: "/tmp/oggen/py" },
    stdio: "pipe",
  });
  return fs.readFileSync(outPath);
}

const bodoni = await staticTtf("bodoni-moda-latin.woff2", ["wght=700", "opsz=96"]);
const interTight = await staticTtf("inter-tight-latin.woff2", ["wght=400"]);

const element = {
  type: "div",
  props: {
    style: {
      width: `${W}px`,
      height: `${H}px`,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      background: SURFACE,
      padding: "84px",
    },
    children: [
      // Wordmark row
      {
        type: "div",
        props: {
          style: { display: "flex", alignItems: "center", gap: "24px" },
          children: [
            {
              type: "div",
              props: {
                style: {
                  width: "30px",
                  height: "30px",
                  borderRadius: "9px",
                  background: PRIMARY,
                  display: "flex",
                },
              },
            },
            {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  fontFamily: "Inter Tight",
                  fontWeight: 700,
                  fontSize: "30px",
                  letterSpacing: "10px",
                  color: ON_PRIMARY,
                },
                children: "OPENBUFF",
              },
            },
          ],
        },
      },
      // Hero + rule
      {
        type: "div",
        props: {
          style: { display: "flex", flexDirection: "column", gap: "36px" },
          children: [
            {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  fontFamily: "Bodoni Moda",
                  fontWeight: 700,
                  fontSize: "96px",
                  lineHeight: 1.05,
                  color: ON_PRIMARY,
                  maxWidth: "1000px",
                },
                children: "Your agents, your machine.",
              },
            },
            {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  width: "120px",
                  height: "12px",
                  borderRadius: "999px",
                  background: PRIMARY,
                },
              },
            },
          ],
        },
      },
      // Subline
      {
        type: "div",
        props: {
          style: {
            display: "flex",
            fontFamily: "Inter Tight",
            fontWeight: 400,
            fontSize: "34px",
            color: "rgba(252,250,246,0.72)",
            maxWidth: "980px",
          },
          children:
            "The open web app for Freebuff — local-first, ad-free, running on your machine.",
        },
      },
    ],
  },
};

const svg = await satori(element, {
  width: W,
  height: H,
  fonts: [
    { name: "Bodoni Moda", data: bodoni, weight: 700, style: "normal" },
    { name: "Inter Tight", data: interTight, weight: 400, style: "normal" },
  ],
});

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: W },
  font: { loadSystemFonts: false },
});
fs.writeFileSync(OUT, resvg.render().asPng());
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`wrote ${OUT} (${fs.statSync(OUT).size} bytes)`);
