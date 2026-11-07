/**
 * Profile pictures: GitHub's for its "noreply" addresses, Gravatar's for everything else.
 * Only used when switched on in the View menu, since it asks those services about the
 * authors (Gravatar gets a hash of the email address, not the address itself).
 */

const urls = new Map<string, Promise<string | null>>();
/** Pictures that failed to load (no Gravatar, offline, …): use initials instead. */
export const failedAvatars = new Set<string>();

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function lookup(email: string): Promise<string | null> {
  const address = email.trim().toLowerCase();
  if (!address.includes("@")) return null;
  const withId = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/.exec(address);
  if (withId) return `https://avatars.githubusercontent.com/u/${withId[1]}?s=80&v=4`;
  const user = /^([^@+]+)@users\.noreply\.github\.com$/.exec(address);
  if (user) return `https://github.com/${user[1]}.png?size=80`;
  if (!crypto?.subtle) return null;
  return `https://www.gravatar.com/avatar/${await sha256(address)}?s=80&d=404`;
}

export function avatarUrl(email: string): Promise<string | null> {
  if (!urls.has(email)) urls.set(email, lookup(email).catch(() => null));
  return urls.get(email)!;
}
