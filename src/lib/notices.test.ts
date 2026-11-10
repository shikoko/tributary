import { describe, expect, it } from "vitest";
import { parseNotices, searchNotices } from "./notices";

const RULE = "=".repeat(78);
const SAMPLE = [
  "Third-party notices for Tributary",
  "",
  "Some words about it.",
  "",
  RULE,
  "",
  "alpha 1.0.0 (MIT OR Apache-2.0) https://example.com/alpha",
  "beta 2.1.0 (MIT) https://example.com/beta",
  "",
  "MIT License",
  "",
  "Copyright (c) Maya Chen",
  "",
  RULE,
  "",
  "alpha 1.0.0 (MIT OR Apache-2.0) https://example.com/alpha",
  "",
  "Apache License",
  "Version 2.0",
  "",
  RULE,
  "",
  "These packages don't include a licence file; their licences are the standard texts named:",
  "",
  "@scope/gamma 0.3.0 ((MIT OR Apache-2.0) AND Unicode-3.0) https://example.com/gamma",
  "",
].join("\n");

describe("third-party notices", () => {
  const packages = parseNotices(SAMPLE);

  it("lists each package once, by name, with every licence text that covers it", () => {
    expect(packages.map((entry) => entry.name)).toEqual(["@scope/gamma", "alpha", "beta"]);
    const alpha = packages.find((entry) => entry.name === "alpha");
    expect(alpha).toMatchObject({ version: "1.0.0", license: "MIT OR Apache-2.0", home: "https://example.com/alpha" });
    expect(alpha?.texts).toEqual(["MIT License\n\nCopyright (c) Maya Chen", "Apache License\nVersion 2.0"]);
    expect(packages.find((entry) => entry.name === "beta")?.texts).toEqual(["MIT License\n\nCopyright (c) Maya Chen"]);
  });

  it("keeps the packages that come without a licence file, and licences with brackets", () => {
    const gamma = packages.find((entry) => entry.name === "@scope/gamma");
    expect(gamma).toMatchObject({ license: "(MIT OR Apache-2.0) AND Unicode-3.0", texts: [] });
  });

  it("finds packages by name or licence", () => {
    expect(searchNotices(packages, "").length).toBe(3);
    expect(searchNotices(packages, "ALPHA").map((entry) => entry.name)).toEqual(["alpha"]);
    expect(searchNotices(packages, "unicode").map((entry) => entry.name)).toEqual(["@scope/gamma"]);
    expect(searchNotices(packages, "mit apache").map((entry) => entry.name)).toEqual(["@scope/gamma", "alpha"]);
  });
});
