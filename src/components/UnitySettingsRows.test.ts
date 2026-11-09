import { describe, expect, it } from "vitest";
import { isUnityYaml } from "../api/engines";
import { toolLabel } from "./UnitySettingsRows";

describe("Unity's Smart Merge", () => {
  it("names a program by its editor's version", () => {
    expect(toolLabel("C:\\Program Files\\Unity\\Hub\\Editor\\2022.3.10f1\\Editor\\Data\\Tools\\UnityYAMLMerge.exe")).toBe("Unity 2022.3.10f1");
    expect(toolLabel("/Applications/Unity/Hub/Editor/6000.0.23f1/Unity.app/Contents/Tools/UnityYAMLMerge")).toBe("Unity 6000.0.23f1");
    expect(toolLabel("/opt/tools/UnityYAMLMerge")).toBe("/opt/tools/UnityYAMLMerge");
  });

  it("knows the files Unity saves as YAML", () => {
    expect(isUnityYaml("Assets/Scenes/Tavern.unity")).toBe(true);
    expect(isUnityYaml("Assets/Prefabs/Door.prefab")).toBe(true);
    expect(isUnityYaml("Assets/Textures/Door.png")).toBe(false);
    expect(isUnityYaml("unity")).toBe(false);
  });
});
