// Game engines: what Unreal's actors saved in their own files (World Partition) are, and
// Unity's Smart Merge for scenes and prefabs.
import { invoke } from "@tauri-apps/api/core";
import type { ActorName, UnitySetup } from "./generated";
export type { ActorName, UnitySetup };

/** Whether a file is an actor (or object) saved in its own file by Unreal Engine. */
export function isExternalActor(path: string): boolean {
  return path.endsWith(".uasset") && /(^|\/)__External(Actors|Objects)__\//.test(path);
}

/**
 * What the actors among `files` are, at commit `at` (or null, in the working tree). Files not
 * there are read at `fallback` (by default the first parent, or the checked-out commit).
 */
export function actorNames(path: string, at: string | null, fallback: string | null, files: string[]): Promise<Record<string, ActorName>> {
  return invoke<Record<string, ActorName>>("actor_names", { path, at, fallback, files });
}

export function unitySetup(path: string): Promise<UnitySetup> {
  return invoke<UnitySetup>("unity_setup", { path });
}

/** The kinds of files Unity saves as YAML, which Smart Merge can merge. */
export const UNITY_YAML = ["unity", "prefab", "asset", "mat", "anim", "controller", "overrideController", "physicMaterial", "physicsMaterial2D", "playable", "mask", "brush", "flare", "fontsettings", "guiskin", "giparams", "renderTexture", "spriteatlas", "terrainlayer", "mixer", "shadervariants", "preset", "lighting", "signal"];

/** Whether Unity saves a file like this as YAML (a scene, prefab, material, …). */
export function isUnityYaml(path: string): boolean {
  const extension = path.slice(path.lastIndexOf(".") + 1);
  return path.includes(".") && UNITY_YAML.includes(extension);
}
