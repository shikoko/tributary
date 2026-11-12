// Submodules: other repositories kept inside this one, each at a commit it records.
import { invoke } from "@tauri-apps/api/core";
import type { Submodule, SubmoduleState } from "./generated";
export type { Submodule, SubmoduleState };

export function submodules(path: string): Promise<Submodule[]> {
  return invoke<Submodule[]>("submodules", { path });
}
