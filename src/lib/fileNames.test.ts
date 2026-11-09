import { describe, expect, it } from "vitest";
import { describeNameProblem } from "./fileNames";

describe("file name problems", () => {
  it("says what's wrong with each", () => {
    expect(describeNameProblem({ path: "content/a.png", problem: "caseClash", detail: "Content" })).toBe(
      "the same as Content but for capitals: on Windows and macOS they're one",
    );
    expect(describeNameProblem({ path: "aux.txt", problem: "reserved", detail: "aux.txt" })).toBe("a name Windows keeps for devices");
    expect(describeNameProblem({ path: "CON/a.txt", problem: "reserved", detail: "CON" })).toBe("its folder “CON” is a name Windows keeps for devices");
    expect(describeNameProblem({ path: "a?.png", problem: "character", detail: "?" })).toBe("Windows doesn't allow “?” in names");
    expect(describeNameProblem({ path: "a\\b", problem: "character", detail: "\\" })).toContain("a backslash");
    expect(describeNameProblem({ path: "notes./x", problem: "trailingDot", detail: "notes." })).toBe("its folder “notes.” ends in a dot, which Windows drops");
    expect(describeNameProblem({ path: "x", problem: "tooLong", detail: "231" })).toMatch(/^231 characters long/);
  });
});
