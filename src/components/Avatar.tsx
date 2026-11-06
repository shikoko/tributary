import { avatarColor } from "../lib/colors";
import { initials } from "../lib/format";

export function Avatar({ name, email, size = 20 }: { name: string; email: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: avatarColor(email || name), fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
