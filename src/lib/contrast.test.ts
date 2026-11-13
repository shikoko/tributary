import { describe, expect, it } from "vitest";
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
import { contrast, parseHex } from "./appearance";

// The themes' colours, from theme.css: the dark one (:root), and the light one over it.
const css = readFileSync(new URL("../styles/theme.css", import.meta.url), "utf8") as string;
function colours(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((match) => [match[1], match[2]]));
}
const dark = colours(":root");
const light = { ...dark, ...colours(':root[data-theme="light"]') };
const themes = {
  dark,
  light,
  // Diffs in blue and orange, for red-green colour blindness.
  "dark blue-orange": { ...dark, ...colours(':root[data-diff-colors="blue-orange"]') },
  "light blue-orange": { ...light, ...colours(':root[data-theme="light"][data-diff-colors="blue-orange"]') },
};

// What text sits on: the window and its panels, menus and cards, and rows pointed at or
// selected. (Not the moment a button is pressed.)
const SURFACES = ["--bg", "--bg-panel", "--bg-raised", "--bg-hover", "--bg-selected", "--chrome", "--chrome-raised"];
// Text, from the brightest grey down, and coloured text.
const GREYS = ["--text", "--text-secondary", "--text-muted", "--text-faint"];
const COLOURED = ["--accent-ink", "--accent-text", "--danger-strong-text", "--added-number", "--removed-number", "--syntax-comment"];

// Counts of added, changed and deleted files, and the colour they sit on a 13% tint of.
const COUNTS = [
  ["--added-ink", "--added"],
  ["--modified-ink", "--warning"],
  ["--deleted-ink", "--danger"],
];

// Text on a solid colour, and the colour (and its hover) it's on.
const ON_SOLID = [["--on-danger-solid", "--danger-solid", "--danger-solid-hover"]];

/** `text`'s lowest contrast on the surfaces, in `theme`. */
function lowest(theme: Record<string, string>, text: string): number {
  return Math.min(...SURFACES.map((surface) => contrast(parseHex(theme[text])!, parseHex(theme[surface])!)));
}

describe("the themes' text", () => {
  for (const [name, theme] of Object.entries(themes)) {
    // WCAG AA: 4.5 to 1 for text of the size most of the interface is.
    it(`reads on every surface, in the ${name} theme`, () => {
      const weak = [...GREYS, ...COLOURED].filter((text) => lowest(theme, text) < 4.5).map((text) => `${text} ${lowest(theme, text).toFixed(2)}`);
      expect(weak).toEqual([]);
    });

    it(`counts changed files readably, in the ${name} theme`, () => {
      const tint = (colour: string, surface: string) => parseHex(theme[colour])!.map((value, i) => value * 0.13 + parseHex(theme[surface])![i] * 0.87) as [number, number, number];
      const weak = COUNTS.filter(([ink, colour]) => SURFACES.some((surface) => contrast(parseHex(theme[ink])!, tint(colour, surface)) < 4.5)).map(([ink]) => ink);
      expect(weak).toEqual([]);
    });

    it(`reads on solid buttons, pointed at or not, in the ${name} theme`, () => {
      const weak = ON_SOLID.flatMap(([text, ...under]) =>
        under.filter((colour) => contrast(parseHex(theme[text])!, parseHex(theme[colour])!) < 4.5).map((colour) => `${text} on ${colour}`),
      );
      expect(weak).toEqual([]);
    });

    it(`steps down from text to faint, in the ${name} theme`, () => {
      const on = (text: string) => contrast(parseHex(theme[text])!, parseHex(theme["--bg"])!);
      for (let i = 1; i < GREYS.length; i++) expect(on(GREYS[i])).toBeLessThan(on(GREYS[i - 1]));
    });
  }
});
