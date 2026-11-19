import { describe, expect, it } from "vitest";
import type { Hunk, RequestComment } from "../api";
import { commentsByFile, placeThreads, threadsAtLine, threadsOn } from "./reviewThreads";

const comment = (id: string, more: Partial<RequestComment> = {}): RequestComment => ({
  id,
  author: "lena-fischer",
  body: id,
  created: "",
  review: null,
  path: "Config/DefaultGame.ini",
  line: 3,
  side: "after",
  outdated: false,
  hunk: null,
  thread: null,
  reply: false,
  ...more,
});

// Line 2 was "Version=0.2" and is now "Version=0.3"; line 1 is the same before and after.
const hunks: Hunk[] = [
  {
    section: "",
    lines: [
      { kind: "context", old: 1, new: 1, text: "[Game]" },
      { kind: "removed", old: 2, new: null, text: "Version=0.2" },
      { kind: "added", old: null, new: 2, text: "Version=0.3" },
      { kind: "added", old: null, new: 3, text: "Name=Feast" },
    ],
  },
];

describe("review threads", () => {
  it("puts replies in their thread, and keeps to the one file", () => {
    const threads = threadsOn(
      [
        comment("l1", { thread: "1" }),
        comment("l2", { thread: "1", reply: true }),
        // A reply that doesn't say where is still in its thread.
        comment("l5", { thread: "1", reply: true, path: null, line: null, side: null }),
        comment("l3", { thread: "3", line: 1 }),
        comment("l4", { path: "Source/Game.cpp", thread: "4" }),
        comment("c1", { path: null, line: null }),
      ],
      "Config/DefaultGame.ini",
    );
    expect(threads.map((thread) => [thread.id, thread.comments.map((each) => each.id), thread.line])).toEqual([
      ["1", ["l1", "l2", "l5"], 3],
      ["3", ["l3"], 1],
    ]);
  });

  it("places each thread under its line, on the side it's on", () => {
    const threads = threadsOn(
      [
        comment("after", { thread: "a", line: 2 }),
        comment("before", { thread: "b", line: 2, side: "before" }),
        comment("unchanged", { thread: "c", line: 1, side: "before" }),
      ],
      "Config/DefaultGame.ini",
    );
    const { at, elsewhere } = placeThreads(threads, hunks);
    expect(elsewhere).toEqual([]);
    // The removed line 2 has the comment on it as it was; the added line 2 the one on it as it is.
    expect(threadsAtLine(at, 2, null).map((thread) => thread.id)).toEqual(["b"]);
    expect(threadsAtLine(at, null, 2).map((thread) => thread.id)).toEqual(["a"]);
    // An unchanged line is on both sides.
    expect(threadsAtLine(at, 1, 1).map((thread) => thread.id)).toEqual(["c"]);
    expect(threadsAtLine(at, null, 3)).toEqual([]);
  });

  it("puts aside threads on lines that changed since, or that aren't shown", () => {
    const threads = threadsOn(
      [comment("old", { thread: "o", line: 3, outdated: true }), comment("far", { thread: "f", line: 40 }), comment("file", { thread: "w", line: null })],
      "Config/DefaultGame.ini",
    );
    const { at, elsewhere } = placeThreads(threads, hunks);
    expect(at.size).toBe(0);
    expect(elsewhere.map((thread) => thread.id)).toEqual(["o", "f", "w"]);
  });

  it("counts each file's comments", () => {
    const counts = commentsByFile([comment("a"), comment("b", { reply: true }), comment("c", { path: "Source/Game.cpp" }), comment("d", { path: null })]);
    expect([...counts]).toEqual([
      ["Config/DefaultGame.ini", 2],
      ["Source/Game.cpp", 1],
    ]);
  });
});
