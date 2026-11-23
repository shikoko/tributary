import { describe, expect, it } from "vitest";
import type { CommitRow, GraphLine } from "../api";
import { DEFAULT_APPEARANCE, normalizeAppearance, type Appearance } from "./appearance";
import { branchScheme, fits, graphColours, mergedBranch, shadesOf } from "./branchColours";

/** A commit in `column` with its graph's lines: [kind, from, to] (0 past it, 1 into it from above, 2 down from it). */
function commit(id: string, column: number, lines: [0 | 1 | 2, number, number][], options: { parents?: string[]; refs?: [string, string][]; summary?: string; kind?: string } = {}) {
  return {
    id,
    kind: options.kind ?? "commit",
    summary: options.summary ?? `Commit ${id}`,
    parents: options.parents ?? [],
    refs: (options.refs ?? []).map(([kind, name]) => ({ kind, name })),
    graph: { column, lines: lines.map(([kind, from, to]) => [kind, from, to, 0] as GraphLine) },
  } as unknown as CommitRow;
}

const MAIN = "#ffad1f";
const scheme = (patch: Partial<Appearance> = {}) =>
  branchScheme(normalizeAppearance({ ...DEFAULT_APPEARANCE, mainColour: MAIN, lanes: "custom", customLanes: ["#ffad1f", "#1fb5ff", "#ff4f9a"], ...patch }), "dark");

// feature/curtains (column 1) has two commits, branched from main's second; main has three.
const feature = [
  commit("f2", 1, [[2, 1, 1]], { parents: ["f1"], refs: [["branch", "feature/curtains"]] }),
  commit("m3", 0, [[0, 1, 1], [2, 0, 0]], { parents: ["m2"], refs: [["branch", "main"]] }),
  commit("f1", 1, [[0, 0, 0], [1, 1, 1], [2, 1, 1]], { parents: ["m2"] }),
  commit("m2", 0, [[1, 0, 0], [1, 1, 0], [2, 0, 0]], { parents: ["m1"] }),
  commit("m1", 0, [[1, 0, 0]]),
];

// A pull request from feature/b merged into main, and fix/c started from main just after it.
const merged = [
  commit("m4", 0, [[2, 0, 0], [2, 0, 1]], { parents: ["m3", "b1"], refs: [["branch", "main"]], summary: "Merge pull request #2 from someone/feature/b" }),
  commit("b1", 1, [[0, 0, 0], [1, 1, 1], [2, 1, 1]], { parents: ["m3"] }),
  commit("m3", 0, [[1, 0, 0], [1, 1, 0], [2, 0, 0]], { parents: ["m2"] }),
  commit("c1", 1, [[0, 0, 0], [2, 1, 1]], { parents: ["m2"], refs: [["remote", "origin/fix/c"]] }),
  commit("m2", 0, [[1, 0, 0], [1, 1, 0], [2, 0, 0]], { parents: ["m1"] }),
  commit("m1", 0, [[1, 0, 0]]),
];

describe("graphColours, each branch its own colour", () => {
  it("gives the main branch's line main's colour, and a branch's whole line one colour of its own", () => {
    const { rows } = graphColours(feature, scheme());
    for (const index of [1, 3, 4]) expect(rows[index].node).toBe(MAIN);
    const branch = rows[0].node;
    expect(branch).not.toBe(MAIN);
    expect(rows[2].node).toBe(branch);
    // Its line past main's newest commit, and into the commit it was branched from.
    expect(rows[1].lines).toEqual([branch, MAIN]);
    expect(rows[3].lines).toEqual([MAIN, branch, MAIN]);
  });

  it("never gives another branch main's colour, or one too close to it", () => {
    const own = scheme({ customLanes: ["#ffad1f", "#ffb020", "#1fb5ff", "#ff4f9a"] });
    expect(own.palette).toEqual(["#1fb5ff", "#ff4f9a"]);
  });

  it("gives a branch started where a merged one ended a different colour", () => {
    const { rows } = graphColours(merged, scheme());
    expect(rows[1].node).not.toBe(MAIN);
    expect(rows[3].node).not.toBe(MAIN);
    expect(rows[3].node).not.toBe(rows[1].node);
    // The merge's line to the branch it brought in is that branch's colour.
    expect(rows[0].lines).toEqual([MAIN, rows[1].node]);
  });

  it("keeps a branch's colour when commits are added on top", () => {
    const before = graphColours(feature, scheme()).rows[0].node;
    const newer = [commit("f3", 1, [[2, 1, 1]], { parents: ["f2"], refs: [["branch", "feature/curtains"]] }), { ...feature[0], refs: [] }, ...feature.slice(1)];
    // The new commit's line comes down into the old tip, which now has a line into it.
    newer[1] = commit("f2", 1, [[1, 1, 1], [2, 1, 1]], { parents: ["f1"] });
    expect(graphColours(newer, scheme()).rows[0].node).toBe(before);
  });

  it("gives a stash the colour of the branch it was made on, though a branch starts in its column next", () => {
    // As the notebook demo has it: a stash on origin/main's commit, and feature/themes in the
    // stash's column straight after.
    const rows = [
      commit("main", 0, [[2, 0, 0]], { parents: ["origin"], refs: [["branch", "main"]] }),
      commit("stash", 1, [[0, 0, 0], [2, 1, 1]], { parents: ["origin"], kind: "stash", refs: [["stash", "stash@{0}"]] }),
      commit("origin", 0, [[1, 0, 0], [1, 1, 0], [2, 0, 0]], { parents: ["m1"], refs: [["remote", "origin/main"]] }),
      commit("themes", 1, [[0, 0, 0], [2, 1, 1]], { parents: ["t1"], refs: [["branch", "feature/themes"]] }),
      commit("m1", 0, [[1, 0, 0], [0, 1, 1], [2, 0, 0]], { parents: ["m0"] }),
      commit("t1", 1, [[0, 0, 0], [1, 1, 1], [2, 1, 1]], { parents: ["m0"] }),
      commit("m0", 0, [[1, 0, 0], [1, 1, 0]]),
    ];
    const { rows: colours } = graphColours(rows, scheme());
    expect(colours[1].node).toBe(MAIN);
    expect(colours[3].node).not.toBe(MAIN);
  });

  it("gives uncommitted changes the colour of the branch they're on", () => {
    const changes = [commit("worktree", 0, [[2, 0, 0]], { kind: "worktree" }), ...feature.slice(1).map((each, index) => (index === 0 ? commit("m3", 0, [[1, 0, 0], [2, 0, 0]], { parents: ["m2"], refs: [["branch", "main"]] }) : each))];
    expect(graphColours(changes, scheme()).rows[0].node).toBe(MAIN);
  });
});

describe("graphColours, by kind of branch", () => {
  const kinds = scheme({ branchColours: "kinds", shades: false });

  it("colours a branch by its kind, from its name or the merge that brought it in", () => {
    const { rows } = graphColours(merged, kinds);
    expect(rows[1].node).toBe(kinds.kinds[0].colours[0]); // feature/b, from the merge's message
    expect(rows[3].node).toBe(kinds.kinds[1].colours[0]); // fix/c, from origin/fix/c
    expect(rows[0].node).toBe(MAIN);
  });

  it("gives a branch of no kind everything else's colour", () => {
    const other = [{ ...feature[0], refs: [{ kind: "branch", name: "experiments" }] } as CommitRow, ...feature.slice(1)];
    expect(graphColours(other, kinds).rows[0].node).toBe(kinds.other[0]);
  });

  it("gives branches of one kind side by side shades of its colour", () => {
    const sideBySide = [
      commit("a2", 1, [[2, 1, 1]], { parents: ["a1"], refs: [["branch", "feature/a"]] }),
      commit("b1", 2, [[0, 1, 1], [2, 2, 2]], { parents: ["m1"], refs: [["branch", "feature/b"]] }),
      commit("a1", 1, [[1, 1, 1], [0, 2, 2], [2, 1, 1]], { parents: ["m1"] }),
      commit("m1", 0, [[1, 1, 0], [1, 2, 0]], { refs: [["branch", "main"]] }),
    ];
    const shaded = scheme({ branchColours: "kinds" });
    const { rows } = graphColours(sideBySide, shaded);
    expect(rows[0].node).toBe(shaded.kinds[0].colours[0]);
    expect(shaded.kinds[0].colours).toContain(rows[1].node);
    expect(rows[1].node).not.toBe(rows[0].node);
    // Without shades, they're the same colour.
    const plain = graphColours(sideBySide, kinds).rows;
    expect(plain[1].node).toBe(plain[0].node);
  });
});

describe("names", () => {
  it("finds the branch a merge brought in", () => {
    expect(mergedBranch("Merge pull request #12 from someone/feature/stage-lights")).toBe("feature/stage-lights");
    expect(mergedBranch("Merge branch 'fix/wallet' into 'main'")).toBe("fix/wallet");
    expect(mergedBranch("Merge remote-tracking branch 'origin/release/1.2'")).toBe("release/1.2");
    expect(mergedBranch("Merged in hotfix/save (pull request #4)")).toBe("hotfix/save");
    expect(mergedBranch("Add the shop")).toBeNull();
  });

  it("fits names to patterns, * standing for anything, in any case", () => {
    expect(fits("feature/curtains", "feature/*")).toBe(true);
    expect(fits("Feature/Curtains", "feature/*")).toBe(true);
    expect(fits("features/curtains", "feature/*")).toBe(false);
    expect(fits("main", "main")).toBe(true);
    expect(fits("main-old", "main")).toBe(false);
    expect(fits("team/fix/x", "*/fix/*")).toBe(true);
    expect(fits("a.b", "a.b")).toBe(true);
    expect(fits("axb", "a.b")).toBe(false);
  });

  it("makes shades lighter, then darker, of a colour (darker first in the light theme)", () => {
    const [colour, lighter, darker] = shadesOf("#1fb5ff", "dark");
    expect(colour).toBe("#1fb5ff");
    expect(lighter > colour).toBe(true);
    expect(darker < colour).toBe(true);
    expect(shadesOf("#1fb5ff", "light")[1]).toBe(darker);
  });
});
