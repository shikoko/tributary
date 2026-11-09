import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { actorNames, isExternalActor, type ActorName } from "../api";

/** The actors in the file list being drawn, by path: what FileLine shows instead of a hash. */
export const ActorNames = createContext<ReadonlyMap<string, ActorName>>(new Map());

/** The actor a file in the list being drawn is, if it is one. */
export function useActorName(path: string): ActorName | undefined {
  return useContext(ActorNames).get(path);
}

/** Names read at a commit don't change: they're kept, by repository, commit and file. */
const kept = new Map<string, ActorName>();
const NO_NAMES: ReadonlyMap<string, ActorName> = new Map();
/** Asked about this many files at a time. */
const BATCH = 1000;

/**
 * What the Unreal actors among `files` are (most files aren't any: nothing's asked for them),
 * at commit `at`, or in the working tree when it's null.
 */
export function useActorNames(repoPath: string, at: string | null, fallback: string | null, files: readonly { path: string }[] | undefined): ReadonlyMap<string, ActorName> {
  const wanted = useMemo(() => (files ?? []).map((file) => file.path).filter(isExternalActor), [files]);
  const key = wanted.join("\n");
  const [names, setNames] = useState<{ key: string; names: ReadonlyMap<string, ActorName> }>({ key: "", names: NO_NAMES });
  useEffect(() => {
    if (wanted.length === 0) return;
    let current = true;
    const keyOf = (file: string) => `${repoPath}\n${at}\n${fallback}\n${file}`;
    const found = new Map<string, ActorName>();
    const missing: string[] = [];
    for (const file of wanted) {
      const name = at ? kept.get(keyOf(file)) : undefined;
      if (name) found.set(file, name);
      else missing.push(file);
    }
    const show = () => current && setNames({ key, names: new Map(found) });
    if (found.size > 0) show();
    (async () => {
      for (let start = 0; start < missing.length && current; start += BATCH) {
        const batch = await actorNames(repoPath, at, fallback, missing.slice(start, start + BATCH));
        for (const [file, name] of Object.entries(batch)) {
          found.set(file, name);
          if (at) kept.set(keyOf(file), name);
        }
        show();
      }
    })().catch(() => {});
    return () => {
      current = false;
    };
    // `key` stands for `wanted`.
  }, [repoPath, at, fallback, key]);
  return wanted.length > 0 && names.key === key ? names.names : NO_NAMES;
}

/** "SM_RackShelf_215 (StaticMeshActor) in Maps/Tavern". */
export function describeActor(actor: ActorName): string {
  const what = actor.label ?? actor.class ?? "An actor";
  const kind = actor.label && actor.class ? ` (${actor.class})` : "";
  return `${what}${kind}${actor.level ? ` in ${actor.level}` : ""}`;
}
