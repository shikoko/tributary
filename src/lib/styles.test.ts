import { describe, expect, it } from "vitest";
// @ts-expect-error type error without @types/node package
import { readFileSync, readdirSync } from "node:fs";

// Every stylesheet, as text. (Read from disk: when testing, Vitest empties CSS files it's
// asked to import, even as text.)
const folder = new URL("../styles/", import.meta.url);
const sheets: [string, string][] = (readdirSync(folder) as string[])
  .filter((name) => name.endsWith(".css"))
  .map((name) => [name, readFileSync(new URL(name, folder), "utf8") as string]);
// The catalogue's own, which uses the same scales.
sheets.push(["catalogue.css", readFileSync(new URL("../catalogue/catalogue.css", import.meta.url), "utf8") as string]);

/** Each `pattern` match in the stylesheets, as "file: what it says". */
function found(pattern: RegExp): string[] {
  return sheets.flatMap(([name, css]) => [...css.matchAll(pattern)].map((match) => `${name}: ${match[0]}`));
}

describe("the stylesheets", () => {
  it("are read", () => {
    expect(sheets.length).toBeGreaterThan(20);
    expect(found(/font-size: var\(--type-sm\)/g).length).toBeGreaterThan(100);
    expect(found(/var\(--space-8\)/g).length).toBeGreaterThan(100);
  });

  // The scale is in theme.css: a size of its own would drift from things like it.
  it("size text with the scale, not in pixels", () => {
    expect(found(/font-size:\s*[0-9.]+px/g)).toEqual([]);
  });

  it("round corners with the scale, not in pixels", () => {
    expect(found(/border(?:-[a-z]+)*-radius:[^;]*\b[0-9.]+px/g)).toEqual([]);
  });

  // Padding, margins and gaps: pixels from 2px up only with their reason beside them, like
  // "80px; /* room for the window buttons */". Hairline nudges (1px) are fine.
  it("space things with the scale, not in pixels", () => {
    const spacing = /(?<![-\w])(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?\s*:[^;{}]*?(?<![0-9.])(?:[2-9]|[1-9][0-9]+)(?:\.[0-9]+)?px[^;{}]*;(?![ \t]*\/\*)/g;
    expect(found(spacing)).toEqual([]);
  });

  // Colours come from the theme (theme.css), so they change with it. One that's the same in
  // every theme on purpose, like Windows' red close button, has its reason beside it. Masks
  // are shapes, not colours.
  it("colour things with the theme's colours", () => {
    const raw = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[0-9.]|hsla?\(|(?<![-\w])(?:white|black)(?![-\w])/;
    const own = sheets
      .filter(([name]) => name !== "theme.css")
      .flatMap(([name, css]) => css.split("\n").map((line) => [name, line] as const))
      .filter(([, line]) => !/^\s*(?:-webkit-)?mask/.test(line) && !line.includes("/*") && raw.test(line))
      .map(([name, line]) => `${name}: ${line.trim()}`);
    expect(own).toEqual([]);
  });
});
