import { describe, expect, it } from "vitest";
import { pickApps } from "./apps";

const apps = [
  { id: "vscode", name: "Visual Studio Code", terminal: false },
  { id: "rider", name: "Rider", terminal: false },
  { id: "terminal", name: "Terminal", terminal: true },
];

describe("editors and terminals", () => {
  it("uses the chosen one while it's installed, or the first", () => {
    expect(pickApps(apps, "rider", null).editor?.name).toBe("Rider");
    expect(pickApps(apps, "zed", null).editor?.name).toBe("Visual Studio Code");
    expect(pickApps(apps, null, null).terminal?.name).toBe("Terminal");
    expect(pickApps([], null, null)).toEqual({ editor: null, terminal: null });
  });
});
