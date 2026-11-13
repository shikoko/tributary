import { describe, expect, it } from "vitest";
// @ts-expect-error type error without @types/node package
import { readFileSync, readdirSync } from "node:fs";

// Every stylesheet but the theme's, as text (read from disk: Vitest empties imported CSS).
const folder = new URL("../styles/", import.meta.url);
const sheets: [string, string][] = (readdirSync(folder) as string[])
  .filter((name) => name.endsWith(".css") && name !== "theme.css")
  .map((name) => [name, readFileSync(new URL(name, folder), "utf8") as string]);

describe("keyboard focus", () => {
  it("is shown with the theme's ring, not one of a stylesheet's own", () => {
    expect(sheets.length).toBeGreaterThan(20);
    const own = sheets.flatMap(([name, css]) => [...css.matchAll(/outline:\s*[0-9.]+px\s+solid[^;]*;/g)].map((match) => `${name}: ${match[0]}`));
    expect(own).toEqual([]);
  });

  it("isn't marked with a shadow instead", () => {
    const shadows = sheets.flatMap(([name, css]) =>
      [...css.matchAll(/[^{}]*:focus(?:-visible)?[^{}]*\{[^}]*box-shadow:[^}]*\}/g)].map((match) => `${name}: ${match[0].trim().split("\n")[0]}`),
    );
    expect(shadows).toEqual([]);
  });
});
