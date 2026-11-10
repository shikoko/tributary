/**
 * Profile pictures, while they're switched on (Settings, Appearance › Commit list; on at first). The app looks them up
 * (GitHub or GitLab for repositories there, then Gravatar) and hands them over as data:
 * URLs. The avatars on screen at the same moment are asked for together.
 */
import { avatars, forgetMissingAvatars } from "../api";

/** Sent when the authors without a picture are to be asked about again. */
export const AVATARS_CHANGED = "tributary:avatars";

/** How long "no picture" stands before asking again (after being offline, say). */
const RETRY_AFTER = 10 * 60_000;
/** Wait this long to gather the avatars a render puts on screen into one request. */
const GATHER = 40;

const pictures = new Map<string, Promise<string | null>>();
/** The answers that have come, to show at once (without a frame of initials) next time. */
const resolved = new Map<string, string | null>();
/** Per repository: the addresses to ask about, and who's waiting for each. */
const waiting = new Map<string, Map<string, ((url: string | null) => void)[]>>();
let timer: ReturnType<typeof setTimeout> | null = null;

function ask() {
  timer = null;
  for (const [repo, emails] of waiting) {
    waiting.delete(repo);
    const settle = (found: Record<string, string | null>) => {
      for (const [email, resolvers] of emails) {
        const url = found[email] ?? null;
        resolved.set(`${repo}\n${email}`, url);
        for (const resolve of resolvers) resolve(url);
        if (!url)
          setTimeout(() => {
            pictures.delete(`${repo}\n${email}`);
            resolved.delete(`${repo}\n${email}`);
          }, RETRY_AFTER);
      }
    };
    avatars(repo, [...emails.keys()]).then(settle, () => settle({}));
  }
}

/** An author's picture if it's known already: a data: URL, null for none, undefined when it isn't known yet. */
export function knownAvatar(repo: string, email: string): string | null | undefined {
  return resolved.get(`${repo}\n${email}`);
}

/** An author's picture as a data: URL, or null when there's none (or it couldn't be fetched). */
export function avatarUrl(repo: string, email: string): Promise<string | null> {
  const key = `${repo}\n${email}`;
  let found = pictures.get(key);
  if (!found) {
    found = new Promise((resolve) => {
      const emails = waiting.get(repo) ?? new Map<string, ((url: string | null) => void)[]>();
      waiting.set(repo, emails);
      emails.set(email, [...(emails.get(email) ?? []), resolve]);
      timer ??= setTimeout(ask, GATHER);
    });
    pictures.set(key, found);
  }
  return found;
}

/**
 * Ask again about everyone found to have no picture, here and in the app (after signing in
 * to GitHub or GitLab, which may now show them), and have the avatars on screen ask again.
 */
export async function askAgainForMissingAvatars() {
  await forgetMissingAvatars().catch(() => {});
  for (const [key, url] of resolved) {
    if (url !== null) continue;
    resolved.delete(key);
    pictures.delete(key);
  }
  window.dispatchEvent(new Event(AVATARS_CHANGED));
}
