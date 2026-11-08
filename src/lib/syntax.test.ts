import { describe, expect, it } from "vitest";
import type { DiffLine } from "../api";
import { highlightCode, highlightHunk, languageFor, pieces, tokensFromHtml } from "./syntax";

describe("syntax", () => {
  it("knows languages by extension and name", () => {
    expect(languageFor("src/store.ts")).toBe("typescript");
    expect(languageFor("Source/Feast/FeastGameMode.cpp")).toBe("cpp");
    expect(languageFor("Shaders/Water.usf")).toBe("cpp");
    expect(languageFor("Dockerfile")).toBe("dockerfile");
    expect(languageFor("Content/Hero.uasset")).toBeNull();
    expect(languageFor("README")).toBeNull();
  });

  it("reads highlight.js's spans, across lines and escaped", () => {
    const lines = tokensFromHtml('<span class="hljs-comment">/* a\nb */</span> x &lt; <span class="hljs-string">&quot;y&quot;</span>');
    expect(lines).toEqual([
      [{ text: "/* a", className: "hljs-comment" }],
      [
        { text: "b */", className: "hljs-comment" },
        { text: " x < ", className: null },
        { text: '"y"', className: "hljs-string" },
      ],
    ]);
  });

  it("colours code, and a comment over several lines stays a comment", () => {
    const tokens = highlightCode("const a = 1; /* one\ntwo */", "typescript")!;
    expect(tokens[0][0]).toEqual({ text: "const", className: "hljs-keyword" });
    expect(tokens[1][0]).toEqual({ text: "two */", className: "hljs-comment" });
    expect(highlightCode("x", "klingon")).toBeNull();
  });

  it("colours a hunk's lines from the side they belong to", () => {
    const lines: DiffLine[] = [
      { kind: "context", old: 1, new: 1, text: "/* start" },
      { kind: "removed", old: 2, new: null, text: "old */ let a = 1;" },
      { kind: "added", old: null, new: 2, text: "new */ let b = 2;" },
    ];
    const [context, removed, added] = highlightHunk(lines, "typescript");
    expect(context![0].className).toBe("hljs-comment");
    expect(removed![0]).toEqual({ text: "old */", className: "hljs-comment" });
    expect(added!.find((token) => token.text === "let")?.className).toBe("hljs-keyword");
  });

  it("merges colours with the changed words", () => {
    const merged = pieces(
      "let a = 10;",
      [
        { text: "let", className: "hljs-keyword" },
        { text: " a = ", className: null },
        { text: "10", className: "hljs-number" },
        { text: ";", className: null },
      ],
      [
        { text: "let a = ", changed: false },
        { text: "10", changed: true },
        { text: ";", changed: false },
      ],
    );
    expect(merged).toEqual([
      { text: "let", className: "hljs-keyword", changed: false },
      { text: " a = ", className: null, changed: false },
      { text: "10", className: "hljs-number", changed: true },
      { text: ";", className: null, changed: false },
    ]);
    expect(pieces("abc", [{ text: "ab", className: "x" }], null)).toEqual([{ text: "abc", className: null, changed: false }]);
  });
});
