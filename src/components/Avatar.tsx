import { createContext, useContext, useEffect, useState } from "react";
import { avatarUrl, knownAvatar } from "../lib/avatars";
import { avatarColor } from "../lib/colors";
import { initials } from "../lib/format";

/** The repository whose authors' pictures to show, or null when pictures are off (Settings). */
export const ProfilePictures = createContext<string | null>(null);

/** While a picture is being asked for, initials wait this long (the answer is usually quicker). */
const INITIALS_AFTER = 400;

/** `color` replaces the initials' usual colour (Team activity gives each person theirs). */
export function Avatar({ name, email, size = 20, color }: { name: string; email: string; size?: number; color?: string }) {
  const repo = useContext(ProfilePictures);
  // A picture already known shows at once.
  const known = repo && email ? knownAvatar(repo, email) : null;
  const [picture, setPicture] = useState<{ email: string; url: string | null } | null>(null);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    if (!repo || !email || known !== undefined) return;
    let live = true;
    avatarUrl(repo, email).then((url) => live && setPicture({ email, url }));
    const timer = setTimeout(() => live && setWaited(true), INITIALS_AFTER);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [repo, email, known]);

  const url = known !== undefined ? known : picture?.email === email ? picture.url : undefined;
  if (repo && url) {
    return <img className="avatar picture" src={url} alt="" style={{ width: size, height: size }} />;
  }
  const style = { width: size, height: size, background: color ?? avatarColor(email || name), fontSize: Math.round(size * 0.42) };
  // Asking for a picture: a plain circle for a moment, rather than initials that are about to change.
  const asking = Boolean(repo && email) && url === undefined && !waited;
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {!asking && <span className="avatar-initials">{initials(name)}</span>}
    </span>
  );
}
