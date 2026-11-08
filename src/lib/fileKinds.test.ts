import { describe, expect, it } from "vitest";
import { fileKind } from "./fileKinds";

describe("fileKind", () => {
  it("knows files by their extension", () => {
    expect(fileKind("Content/UI/Icons/Coin.PNG")).toBe("image");
    expect(fileKind("Content/Audio/DoorCreak.wav")).toBe("audio");
    expect(fileKind("Content/Cinematics/DoorOpen.webm")).toBe("video");
    expect(fileKind("Content/Props/Stool.glb")).toBe("model");
    expect(fileKind("Content/Characters/Barber.uasset")).toBe("engine");
    expect(fileKind("src/store.ts")).toBe("code");
    expect(fileKind("package.json")).toBe("data");
    expect(fileKind("docs/sync.md")).toBe("text");
    expect(fileKind("build.zip")).toBe("archive");
  });

  it("knows some files by their name", () => {
    expect(fileKind("Dockerfile")).toBe("code");
    expect(fileKind(".gitattributes")).toBe("data");
    expect(fileKind("LICENSE")).toBe("text");
    expect(fileKind("README")).toBe("text");
  });

  it("falls back to a plain file, and knows folders", () => {
    expect(fileKind("notes")).toBe("file");
    expect(fileKind("data.xyz")).toBe("file");
    expect(fileKind("src/ui/onboarding/")).toBe("folder");
  });
});
