import { describe, expect, it } from "vitest";
import { reflowBody } from "./message";

describe("reflowBody", () => {
  it("joins lines wrapped by hand back into paragraphs", () => {
    const body = "The barber's scissors were attached to the\nwrong bone, so they floated.\n\nThis fixes it.";
    expect(reflowBody(body)).toEqual([
      { kind: "paragraph", text: "The barber's scissors were attached to the wrong bone, so they floated." },
      { kind: "paragraph", text: "This fixes it." },
    ]);
  });

  it("keeps list items, joining their wrapped lines", () => {
    const body = "- Light the tavern with\n  candles\n  * Warmer fire\n1. Seat guests";
    expect(reflowBody(body)).toEqual([
      { kind: "item", depth: 0, marker: "•", text: "Light the tavern with candles" },
      { kind: "item", depth: 1, marker: "•", text: "Warmer fire" },
      { kind: "item", depth: 0, marker: "1.", text: "Seat guests" },
    ]);
  });

  it("keeps indented and fenced code exactly as written", () => {
    const body = "Run it like this:\n\n    npm run tauri build\n      --target x\n\n```\nlet  a = 1;\n```";
    expect(reflowBody(body)).toEqual([
      { kind: "paragraph", text: "Run it like this:" },
      { kind: "code", text: "npm run tauri build\n  --target x" },
      { kind: "code", text: "let  a = 1;" },
    ]);
  });

  it("keeps trailers on their own lines", () => {
    const body = "Co-authored-by: Rosa Bell <rosa@example.com>\nSigned-off-by: Maya Chen <maya@example.com>";
    expect(reflowBody(body).map((block) => block.kind === "paragraph" && block.text)).toEqual([
      "Co-authored-by: Rosa Bell <rosa@example.com>",
      "Signed-off-by: Maya Chen <maya@example.com>",
    ]);
  });
});
