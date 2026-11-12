import type { ReactNode } from "react";

/**
 * A chip: a state, a branch name, a verdict… with an icon before it if it has one. Its text is
 * trimmed to its letters (`chip-text`), so it sits in the middle of the chip whatever the
 * font's spacing above and below; the chip's own look comes from its `className`.
 */
export function Chip({ className, icon, title, children }: { className: string; icon?: ReactNode; title?: string; children: ReactNode }) {
  return (
    <span className={className} title={title}>
      {icon}
      <span className="chip-text">{children}</span>
    </span>
  );
}
