// Game engines: what Unreal's actors saved in their own files (World Partition) are, and
// Unity's Smart Merge for scenes and prefabs.
import { invoke } from "@tauri-apps/api/core";

/** An actor saved in its own file, under __ExternalActors__. */
export interface ActorName {
  /** Its name in the editor's outliner, like "SM_RackShelf_215". */
  label: string | null;
  /** Its class, short: "StaticMeshActor", or a Blueprint's name, like "BP_Door". */
  class: string | null;
  /** The level it's in, like "Maps/Tavern". */
  level: string | null;
}

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

/** A repository's Unity project, and Unity's Smart Merge (UnityYAMLMerge) set up for it. */
export interface UnitySetup {
  /** There's a Unity project in it (at the top, or in a folder just below). */
  project: boolean;
  /** The editor version it's made with, like "2022.3.10f1". */
  editorVersion: string | null;
  /** The UnityYAMLMerge programs found on this computer, the project's version's first. */
  tools: string[];
  /** Scenes and prefabs are merged with Smart Merge (set up here, or by the team). */
  configured: boolean;
  /** The program git runs to merge them, when set up. */
  configuredTool: string | null;
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
