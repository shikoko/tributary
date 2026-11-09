import { describe, expect, it } from "vitest";
import { describeOwners } from "./codeOwners";

describe("code owners", () => {
  it("names up to two, then counts the rest", () => {
    expect(describeOwners(["@art"])).toBe("@art");
    expect(describeOwners(["@art", "@maya"])).toBe("@art and @maya");
    expect(describeOwners(["@art", "@maya", "@theo", "lena@example.com"])).toBe("@art, @maya and 2 more");
  });
});
