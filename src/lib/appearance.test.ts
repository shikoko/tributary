import { describe, expect, it } from "vitest";
import { accentRoles, ACCENTS, contrast, DEFAULT_APPEARANCE, FILL_CONTRAST, effectiveTheme, LANE_PALETTES, lanePalette, normalizeAppearance, parseHex, textOn } from "./appearance";

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
    expect(normalizeAppearance({ ciDots: "halo" }).ciDots).toBe("halo");
    expect(normalizeAppearance({ ciDots: "sparkly" as never }).ciDots).toBe("ringed");
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
    expect(roles["--accent-pair"]).toBe("#a77bff");
    expect(roles["--accent-ink"]).toBe("#1fb5ff");
    expect(roles["--on-accent"]).toBe("#ffffff");
  });

  it("fills buttons with the accent, deepened until white reads on it, pointed at or not", () => {
    // The built-in accents, and colours of one's own: light, dark and greyish.
    for (const accent of [...ACCENTS.map((a) => a.color), "#ffe24a", "#00ff00", "#ffffff", "#123456", "#9aa1ad"]) {
      for (const theme of ["dark", "light"] as const) {
        const roles = accentRoles(accent, theme);
        for (const fill of [roles["--accent-fill"], roles["--accent-fill-2"]]) {
          expect(contrast(rgb(fill), [255, 255, 255]), `${accent} ${fill}`).toBeGreaterThanOrEqual(FILL_CONTRAST);
          // Brightened by 8% (filter: brightness(1.08)) when the pointer is on it.
          const brighter = rgb(fill).map((value) => Math.min(255, value * 1.08)) as [number, number, number];
          expect(contrast(brighter, [255, 255, 255]), `${accent} ${fill} pointed at`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    // The default's, which theme.css has before the accent is applied.
    expect(accentRoles("#1fb5ff", "dark")["--accent-fill"]).toBe("#136e9b");
    expect(accentRoles("#1fb5ff", "dark")["--accent-fill-2"]).toBe("#3c61c7");
  });

  it("pairs every accent with a different colour", () => {
    for (const accent of [...ACCENTS.map((a) => a.color), "#123456", "#e04040"]) {
      const roles = accentRoles(accent, "dark");
      expect(roles["--accent-pair"], accent).not.toBe(roles["--accent"]);
      expect(roles["--accent-pair-rgb"].split(" ")).toHaveLength(3);
    }
    // A colour of one's own: its partner is a third of the way round the colour wheel.
    expect(accentRoles("#ff0000", "dark")["--accent-pair"]).toBe("#00ff00");
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

  it("keeps your own graph colours, when there are enough of them", () => {
    const yours = normalizeAppearance({ lanes: "custom", customLanes: ["#FF0000", "00ff00", "nope", "#00f"] });
    expect(yours.lanes).toBe("custom");
    expect(yours.customLanes).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
    expect(lanePalette(yours, "light")).toEqual(yours.customLanes);
    // One colour isn't a palette: back to the vivid one.
    expect(normalizeAppearance({ lanes: "custom", customLanes: ["#ff0000"] }).lanes).toBe("vivid");
    expect(lanePalette(DEFAULT_APPEARANCE, "dark")).toEqual(LANE_PALETTES.vivid.dark);
  });

  it("bends lines smoothly next door and round further out, unless asked otherwise", () => {
    expect(DEFAULT_APPEARANCE.curves).toBe("mixed");
    expect(normalizeAppearance({ curves: "round" }).curves).toBe("round");
    expect(normalizeAppearance({ curves: "wiggly" as never }).curves).toBe("mixed");
  });

  it("picks label text that reads on any colour", () => {
    expect(textOn("#ffe24a")).toBe("#0d0f13");
    expect(textOn("#1b3a8a")).toBe("#ffffff");
    // A middling blue, the light theme's first lane: white reads at only 3.7 to 1 on it.
    expect(textOn("#0a8bd1")).toBe("#0d0f13");
    for (const palette of Object.values(LANE_PALETTES))
      for (const color of [...palette.dark, ...palette.light]) expect(contrast(rgb(textOn(color)), rgb(color))).toBeGreaterThan(4.3);
  });
});
