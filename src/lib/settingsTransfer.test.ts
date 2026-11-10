import { describe, expect, it } from "vitest";
import { applySettings, collectSettings } from "./settingsTransfer";

/** A Storage in memory. */
function memory(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  };
}

describe("moving settings", () => {
  it("saves settings but not what only makes sense on this computer", () => {
    const file = collectSettings(
      memory({
        "tributary.zoom": "1.1",
        "tributary.tabs.list": "[]",
        "tributary.place./Users/maya/feast": "{}",
        "tributary.recentRepositories": "[]",
        "tributary.commitDrafts": '{"/Users/maya/feast":{"summary":"Fix the menu","description":"","amend":false}}',
        "tributary.pins:/Users/maya/feast": '["refs/heads/main"]',
        "other.thing": "1",
      }),
      new Date("2026-11-09T10:00:00Z"),
    );
    expect(file.settings).toEqual({ zoom: "1.1", "pins:/Users/maya/feast": '["refs/heads/main"]' });
    expect(file.exported).toBe("2026-11-09T10:00:00.000Z");
  });

  it("puts repository settings on the repository with the same folder name", () => {
    const storage = memory();
    const result = applySettings(
      { app: "Tributary", version: 1, exported: "", settings: { zoom: "1.2", "pins:/Users/maya/feast": "[1]", "pins:/home/x/other": "[2]", bad: "{" } },
      storage,
      ["C:\\Projects\\feast"],
    );
    expect(result).toEqual({ settings: 3, repositories: 1 });
    expect(storage.getItem("tributary.zoom")).toBe("1.2");
    expect(storage.getItem("tributary.pins:C:\\Projects\\feast")).toBe("[1]");
    expect(storage.getItem("tributary.pins:/home/x/other")).toBe("[2]");
    expect(() => applySettings({ app: "Other" }, storage, [])).toThrow();
  });
});
