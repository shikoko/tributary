// Unreal Engine: what the actors saved in their own files (World Partition) are.
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
