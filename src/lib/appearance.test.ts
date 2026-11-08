import { describe, expect, it } from "vitest";
import { accentRoles, ACCENTS, contrast, DEFAULT_APPEARANCE, effectiveTheme, LANE_PALETTES, normalizeAppearance, parseHex } from "./appearance";

const rgb = (hex: string) => parseHex(hex)!;

describe("appearance", () => {
  it("reads hex colours", () => {
    expect(parseHex("#1fb5ff")).toEqual([31, 181, 255]);
    expect(parseHex("abc")).toEqual([170, 187, 204]);
    expect(parseHex("blue")).toBeNull();
  });

  it("fills in missing or broken settings", () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ theme: "light", accent: "#ABC" })).toEqual({ ...DEFAULT_APPEARANCE, theme: "light", accent: "#aabbcc" });
    expect(normalizeAppearance({ accent: "red", lanes: "neon" as never, diffColors: "purple" as never })).toEqual(DEFAULT_APPEARANCE);
  });

  it("follows the system only when asked", () => {
    expect(effectiveTheme("system", false)).toBe("light");
    expect(effectiveTheme("system", true)).toBe("dark");
    expect(effectiveTheme("dark", false)).toBe("dark");
  });

  it("keeps the default accent's look in the dark theme", () => {
    const roles = accentRoles("#1fb5ff", "dark");
    expect(roles["--accent"]).toBe("#1fb5ff");
    expect(roles["--accent-2"]).toBe("#4d7cff");
    expect(roles["--accent-ink"]).toBe("#1fb5ff");
    expect(roles["--on-accent"]).toBe("#ffffff");
  });

  it("makes accent text readable on either theme, whatever the colour", () => {
    const backgrounds = { dark: rgb("#1a1d24"), light: rgb("#f5f6f8") };
    for (const accent of ["#1fb5ff", "#ffe24a", "#222222", "#ffffff", ...ACCENTS.map((a) => a.color)]) {
      for (const theme of ["dark", "light"] as const) {
        const roles = accentRoles(accent, theme);
        for (const role of ["--accent-ink", "--accent-text", "--accent-soft-text", "--accent-strong-text"]) {
          expect(contrast(rgb(roles[role]), backgrounds[theme]), `${accent} ${theme} ${role}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("puts dark text on light accents", () => {
    expect(accentRoles("#ffe24a", "dark")["--on-accent"]).toBe("#0d0f13");
  });

  it("has graph colours for both themes", () => {
    for (const palette of Object.values(LANE_PALETTES)) {
      expect(palette.dark.length).toBe(palette.light.length);
      // Light-theme lanes stand out from the white list.
      for (const color of palette.light) expect(contrast(rgb(color), rgb("#ffffff"))).toBeGreaterThanOrEqual(2.2);
    }
  });
});
