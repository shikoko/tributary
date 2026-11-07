import { createContext, useContext, useEffect, useState } from "react";
import { avatarColor } from "../lib/colors";
import { initials } from "../lib/format";
import { avatarUrl, failedAvatars } from "../lib/avatars";

/** Whether to show profile pictures (a View menu setting). */
export const ProfilePictures = createContext(false);

export function Avatar({ name, email, size = 20 }: { name: string; email: string; size?: number }) {
  const enabled = useContext(ProfilePictures);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!enabled || !email || failedAvatars.has(email)) return;
    let cancelled = false;
    avatarUrl(email).then((found) => !cancelled && setUrl(found));
    return () => {
      cancelled = true;
    };
  }, [enabled, email]);

  const style = { width: size, height: size, background: avatarColor(email || name), fontSize: Math.round(size * 0.42) };
  if (url && !failed) {
    return (
      <img
        className="avatar picture"
        src={url}
        alt=""
        style={{ width: size, height: size }}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => {
          failedAvatars.add(email);
          setFailed(true);
        }}
      />
    );
  }
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
