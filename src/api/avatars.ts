// Profile pictures of commit authors.
import { invoke } from "@tauri-apps/api/core";

/** Each author's picture as a data: URL, by email address as given; null for those without one. */
export function avatars(path: string, emails: string[]): Promise<Record<string, string | null>> {
  return invoke<Record<string, string | null>>("avatars", { path, emails });
}
