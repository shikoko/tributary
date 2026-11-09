import { describe, expect, it } from "vitest";
import { kindOf } from "./repoSize";

describe("repository size", () => {
  it("names kinds of file as Git LFS patterns", () => {
    expect(kindOf("Art/Hero.PSD")).toBe("*.psd");
    expect(kindOf("Makefile")).toBe("Makefile");
    expect(kindOf("Art/.gitkeep")).toBe(".gitkeep");
  });
});
