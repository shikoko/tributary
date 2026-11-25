import { describe, expect, it } from "vitest";
import type { WrittenMessage } from "../api";
import { DEFAULT_SETUP, withProvider, writtenDetail, writtenNote } from "./ai";

const written = (fields: Partial<WrittenMessage>): WrittenMessage => ({
  summary: "Add the tour",
  description: "",
  by: "Claude",
  files: 1,
  leftOut: [],
  shortened: false,
  ...fields,
});

describe("the line under a message written with AI", () => {
  it("says who wrote it, from how many files", () => {
    expect(writtenNote(written({}))).toBe("Written by Claude from 1 staged file");
    expect(writtenNote(written({ files: 3, by: "llama3" }))).toBe("Written by llama3 from 3 staged files");
  });

  it("counts the files sent by name only", () => {
    expect(writtenNote(written({ files: 2, leftOut: ["hero.psd"] }))).toBe("Written by Claude from 2 staged files, and 1 more by name only");
    expect(writtenNote(written({ files: 0, leftOut: ["hero.psd", "logo.png"] }))).toBe("Written by Claude from the names of 2 staged files");
  });

  it("explains what wasn't sent whole", () => {
    expect(writtenDetail(written({}))).toBe("Only the staged changes were sent.");
    expect(writtenDetail(written({ leftOut: ["hero.psd"], shortened: true }))).toBe(
      "Sent by name only, not what's in them (in Git LFS, or not text): hero.psd. Long changes were cut short before they were sent.",
    );
  });
});

describe("choosing another provider", () => {
  it("goes back to the model picked for it", () => {
    const chosen = { ...DEFAULT_SETUP, model: "some-model" };
    expect(withProvider(chosen, "openai")).toEqual({ provider: "openai", model: "", address: "" });
    // The same one keeps its model.
    expect(withProvider(chosen, "anthropic")).toBe(chosen);
  });
});
