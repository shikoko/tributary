import { describe, expect, it } from "vitest";
// @ts-expect-error type error without @types/node package
import { readFileSync, readdirSync } from "node:fs";

// Every stylesheet, as text. (Read from disk: when testing, Vitest empties CSS files it's
// asked to import, even as text.)
const folder = new URL("../styles/", import.meta.url);
const sheets: [string, string][] = (readdirSync(folder) as string[])
  .filter((name) => name.endsWith(".css"))
  .map((name) => [name, readFileSync(new URL(name, folder), "utf8") as string]);

/** Each `pattern` match in the stylesheets, as "file: what it says". */
function found(pattern: RegExp): string[] {
  return sheets.flatMap(([name, css]) => [...css.matchAll(pattern)].map((match) => `${name}: ${match[0]}`));
}

describe("the stylesheets", () => {
  it("are read", () => {
    expect(sheets.length).toBeGreaterThan(20);
    expect(found(/font-size: var\(--type-sm\)/g).length).toBeGreaterThan(100);
  });

  // The scale is in theme.css: a size of its own would drift from things like it.
  it("size text with the scale, not in pixels", () => {
    expect(found(/font-size:\s*[0-9.]+px/g)).toEqual([]);
  });

  it("round corners with the scale, not in pixels", () => {
    expect(found(/border(?:-[a-z]+)*-radius:[^;]*\b[0-9.]+px/g)).toEqual([]);
  });
});
