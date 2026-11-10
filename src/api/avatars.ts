// Profile pictures of commit authors.
import { invoke } from "@tauri-apps/api/core";

/** Each author's picture as a data: URL, by email address as given; null for those without one. */
export function avatars(path: string, emails: string[]): Promise<Record<string, string | null>> {
  return invoke<Record<string, string | null>>("avatars", { path, emails });
}

/** Forget the authors' pictures kept on this computer (when profile pictures are turned off). */
export function forgetAvatars(): Promise<void> {
  return invoke<void>("forget_avatars");
}

/** Ask again about the authors found to have no picture (after signing in). */
export function forgetMissingAvatars(): Promise<void> {
  return invoke<void>("forget_missing_avatars");
}
