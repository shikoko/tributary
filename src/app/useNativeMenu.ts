import { useEffect, useRef } from "react";
import { setNativeMenu } from "../lib/nativeMenu";
import { isMac } from "../lib/platform";
import { nativeMenusFor, type AppMenuDefinition } from "./appMenus";

/**
 * On macOS, the commands go in the system menu bar. It's rebuilt only when the menus
 * change (a label, a check mark, an enabled state), and runs the latest commands.
 */
export function useNativeMenu(menus: AppMenuDefinition[], extra: Record<string, () => void>) {
  const runs = useRef(new Map<string, () => void>());
  runs.current = new Map([
    ...menus.flatMap((m) => m.entries).flatMap((entry) => (entry === "-" ? [] : [[entry.id, entry.run] as const])),
    ...Object.entries(extra),
  ]);
  const signature = isMac ? JSON.stringify(nativeMenusFor(menus)) : "";
  useEffect(() => {
    if (!isMac) return;
    setNativeMenu(JSON.parse(signature), (id) => runs.current.get(id)?.()).catch(() => {});
  }, [signature]);
}
