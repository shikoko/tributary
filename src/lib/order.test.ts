import { describe, expect, it } from "vitest";
import { moved } from "./order";

describe("moving an item in a list", () => {
  it("moves it later, earlier, or not at all", () => {
    expect(moved(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moved(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moved(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("leaves the list it was given alone", () => {
    const list = ["a", "b"];
    moved(list, 0, 1);
    expect(list).toEqual(["a", "b"]);
  });
});
