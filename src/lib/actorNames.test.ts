import { describe, expect, it } from "vitest";
import { isExternalActor } from "../api/engines";
import { describeActor } from "./actorNames";

describe("Unreal actors saved in their own files", () => {
  it("tells them from other files", () => {
    expect(isExternalActor("Content/__ExternalActors__/Maps/Tavern/7/K2/0Q1UKG5YNDRBWFN1VO0RYP.uasset")).toBe(true);
    expect(isExternalActor("Plugins/Ocean/Content/__ExternalObjects__/Maps/Sea/3/FX/NNDQL2S2DOVE0M2RDSCQLI.uasset")).toBe(true);
    expect(isExternalActor("Content/Maps/Tavern.umap")).toBe(false);
    expect(isExternalActor("Content/My__ExternalActors__/x.uasset")).toBe(false);
  });

  it("describes one", () => {
    expect(describeActor({ label: "SM_Bench_Long", class: "StaticMeshActor", level: "Maps/Tavern" })).toBe("SM_Bench_Long (StaticMeshActor) in Maps/Tavern");
    expect(describeActor({ label: null, class: "PointLight", level: null })).toBe("PointLight");
  });
});
