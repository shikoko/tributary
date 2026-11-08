import { createContext, useContext, useEffect, useState } from "react";
import { avatarUrl } from "../lib/avatars";
import { avatarColor } from "../lib/colors";
import { initials } from "../lib/format";

/** The repository whose authors' pictures to show, or null when pictures are off (Settings). */
export const ProfilePictures = createContext<string | null>(null);

export function Avatar({ name, email, size = 20 }: { name: string; email: string; size?: number }) {
  const repo = useContext(ProfilePictures);
  const [picture, setPicture] = useState<{ email: string; url: string } | null>(null);

  useEffect(() => {
    if (!repo || !email) return;
    let live = true;
    avatarUrl(repo, email).then((url) => live && url && setPicture({ email, url }));
    return () => {
      live = false;
    };
  }, [repo, email]);

  if (repo && picture?.email === email) {
    return <img className="avatar picture" src={picture.url} alt="" style={{ width: size, height: size }} />;
  }
  const style = { width: size, height: size, background: avatarColor(email || name), fontSize: Math.round(size * 0.42) };
  return (
    <span className="avatar" style={style} aria-hidden="true">
      <span className="avatar-initials">{initials(name)}</span>
    </span>
  );
}
