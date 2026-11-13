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
const themes = { dark, light: { ...dark, ...colours(':root[data-theme="light"]') } };

// What text sits on: the window and its panels, menus and cards, and rows pointed at or
// selected. (Not the moment a button is pressed.)
const SURFACES = ["--bg", "--bg-panel", "--bg-raised", "--bg-hover", "--bg-selected", "--chrome", "--chrome-raised"];
// Text, from the brightest grey down, and coloured text.
const GREYS = ["--text", "--text-secondary", "--text-muted", "--text-faint"];
const COLOURED = ["--accent-ink", "--accent-text", "--danger-strong-text", "--added-number", "--removed-number", "--syntax-comment"];

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

    it(`steps down from text to faint, in the ${name} theme`, () => {
      const on = (text: string) => contrast(parseHex(theme[text])!, parseHex(theme["--bg"])!);
      for (let i = 1; i < GREYS.length; i++) expect(on(GREYS[i])).toBeLessThan(on(GREYS[i - 1]));
    });
  }
});
