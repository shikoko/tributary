import { useId, type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </Icon>
);

/** Lines of text with a person beside them: who changed each line. */
export const BlameIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="4" cy="4.5" r="1.75" />
    <path d="M1.75 10.5a2.25 2.25 0 0 1 4.5 0M8.5 3.5h5.5M8.5 7h5.5M8.5 10.5h5.5M2 13.5h12" />
  </Icon>
);

/** A globe: places on the network (remotes). */
export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12M8 2c1.9 1.7 2.75 3.8 2.75 6S9.9 12.3 8 14M8 2C6.1 3.7 5.25 5.8 5.25 8S6.1 12.3 8 14" />
  </Icon>
);

/** A key: signing commits. */
export const KeyIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5.25" cy="10.75" r="3" />
    <path d="M7.4 8.6 13.5 2.5M11 5l1.75 1.75M9.5 6.5l1.25 1.25" />
  </Icon>
);

/** An arrow into a commit: folding changes into it (a fixup). */
export const FixupIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="10.25" r="2.5" />
    <path d="M8 1.5v4.5M5.75 3.9 8 6.15l2.25-2.25M8 12.75v1.75" />
  </Icon>
);

/** A page with lines and a tag's notch: a release's notes. */
export const NotesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 1.75h5.5L12.5 4.75v9.5H4z" />
    <path d="M6 7h4.5M6 9.5h4.5M6 12h2.5" />
  </Icon>
);

/** One commit cut into two: two commits on a line, with a cut between them. */
export const SplitCommitIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="3.75" r="2" />
    <circle cx="8" cy="12.25" r="2" />
    <path d="M8 5.75v1M8 9.25v1M4.25 8h7.5" />
  </Icon>
);

/** Two columns: before and after, side by side. */
export const SplitIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.75" y="2.5" width="12.5" height="11" rx="1.75" />
    <path d="M8 2.5v11M3.75 6h2.5M3.75 9h2.5M9.75 6h2.5M9.75 9h2.5" />
  </Icon>
);

/** Two arrows, one each way: comparing two things (and swapping them). */
export const CompareIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13" />
  </Icon>
);

/** A circle, half filled: light and dark, for the appearance settings. */
export const ContrastIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 2.25a5.75 5.75 0 0 1 0 11.5z" fill="currentColor" stroke="none" />
  </Icon>
);

export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M12.5 1.5v3h-3" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

export const BranchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5" cy="3.5" r="1.5" />
    <circle cx="5" cy="12.5" r="1.5" />
    <circle cx="11" cy="5" r="1.5" />
    <path d="M5 5v6M11 6.5c0 2.5-6 2-6 4.5" />
  </Icon>
);

export const LaptopIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3.5" width="10" height="7" rx="1" />
    <path d="M1.5 12.5h13" />
  </Icon>
);

export const CloudIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12.5h7a2.75 2.75 0 0 0 .2-5.5A3.75 3.75 0 0 0 4.6 6.6 3 3 0 0 0 4.5 12.5z" />
  </Icon>
);

export const TagIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 2.5h5l6 6-5 5-6-6z" />
    <circle cx="5.5" cy="5.5" r="0.75" fill="currentColor" />
  </Icon>
);

export const StashIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="3" width="12" height="3.5" rx="1" />
    <path d="M3 6.5v5A1.5 1.5 0 0 0 4.5 13h7a1.5 1.5 0 0 0 1.5-1.5v-5M6.5 9h3" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6l4 4 4-4" />
  </Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4L6 8l4 4" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 4l4 4-4 4" />
  </Icon>
);

export const ChevronUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10l4-4 4 4" />
  </Icon>
);

/** A cloud with an arrow down. */
export const FetchIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 11.5a3 3 0 0 1-.2-6A3.75 3.75 0 0 1 11.6 6a2.75 2.75 0 0 1 .4 5.5" />
    <path d="M8 7.5v6M6 11.5l2 2 2-2" />
  </Icon>
);

export const PullIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.5v8M4.5 7l3.5 3.5L11.5 7M3 13.5h10" />
  </Icon>
);

export const PushIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 13.5v-8M4.5 9 8 5.5 11.5 9M3 2.5h10" />
  </Icon>
);

export const BranchPlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5" cy="3.5" r="1.5" />
    <circle cx="5" cy="12.5" r="1.5" />
    <path d="M5 5v6M11.5 2.5v5M9 5h5" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8h10" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6" />
  </Icon>
);

/** A padlock: a protected branch. */
export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Icon>
);

/** A clock with an arrow going back: restore an earlier version. */
export const HistoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
    <path d="M2.5 2.5v2.5H5" />
    <path d="M8 5v3l2 1.5" />
  </Icon>
);

/** A broom, for cleaning up (pruning branches). */
export const BroomIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.5 2.5 8.6 7.4" />
    <path d="M6.6 6.6 9.4 9.4 7 13.5H3.6c-.6-1.4-.9-3-.5-4.4z" />
    <path d="M5.2 13.5 6.4 11M3.6 11.2l2-1.4" />
  </Icon>
);

export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.5 2.5 13.5 5.5 6 13H3v-3z" />
  </Icon>
);

/** Two sliders, for view settings. */
export const ViewIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 5h11M2.5 11h11" />
    <circle cx="6" cy="5" r="1.75" style={{ fill: "var(--bg-panel)" }} />
    <circle cx="10.5" cy="11" r="1.75" style={{ fill: "var(--bg-panel)" }} />
  </Icon>
);

/** A panel on the left, for the sidebar. */
export const SidebarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6 3v10" />
  </Icon>
);

/** Two lines joining, for merging. */
export const MergeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="9" r="1.5" />
    <path d="M4.5 5v6M4.5 5c0 3 3 4 5.5 4" />
  </Icon>
);

/** A branch moved onto another line, for rebasing. */
export const RebaseIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="11.5" cy="3.5" r="1.5" />
    <path d="M4.5 5v6M11.5 5v2.5a2 2 0 0 1-2 2H6" />
  </Icon>
);

export const CherryIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5" cy="11" r="2.5" />
    <circle cx="11" cy="11.5" r="2.5" />
    <path d="M5 8.5C5.5 5 8 3 11.5 2.5M11 9C10.5 6.5 10.5 4.5 11.5 2.5" />
  </Icon>
);

/** An arrow turning back on itself, for reverting. */
export const RevertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12.5 4.5h-6a3.5 3.5 0 0 0 0 7h4" />
    <path d="M10 2l2.5 2.5L10 7" />
  </Icon>
);

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);

export const KeyboardIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
    <path d="M4 7h1M7 7h1M10 7h2M4.5 9.5h7" />
  </Icon>
);

/** An arrow going back, for resetting. */
export const ResetIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 2.5 2.5 5.5l3 3" />
    <path d="M2.5 5.5h7a4 4 0 0 1 0 8H7" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8.5l3 3 7-7" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5" />
  </Icon>
);

export const CommitIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.5" />
    <path d="M1.5 8h4M10.5 8h4" />
  </Icon>
);

/** The Tributary mark: two branches flowing into the main line. */
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.6 3.7A7.4 7.4 0 0 1 8 3.5c3.5 0 6 4.5 6 4.5a12 12 0 0 1-1.6 2.1M4.2 4.9C2.8 6 2 8 2 8s2.5 4.5 6 4.5c1.2 0 2.3-.4 3.2-1" />
    <path d="M6.6 6.7a2 2 0 0 0 2.7 2.7" />
    <path d="M2 2l12 12" />
  </Icon>
);

export const PinIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.8 2l4.2 4.2-2 .8-2.2 2.2.3 2.8-1 1-2.6-2.6L3 14l3.4-3.5L3.8 7.9l1-1 2.8.3L9.8 5z" />
  </Icon>
);

export const CloneIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2v7.5M5 6.5l3 3 3-3" />
    <path d="M2.5 10.5v1A1.5 1.5 0 0 0 4 13h8a1.5 1.5 0 0 0 1.5-1.5v-1" />
  </Icon>
);

export const NewRepoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
    <path d="M8 7v4M6 9h4" />
  </Icon>
);

export const ActivityIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M4.5 6l2 2-2 2M8 10.5h3.5" />
  </Icon>
);

export const ExternalLinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5" />
    <path d="M11.5 9.5v2.5a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V6A1.5 1.5 0 0 1 4 4.5h2.5" />
  </Icon>
);

export const PullRequestIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="4" cy="3.5" r="1.5" />
    <circle cx="4" cy="12.5" r="1.5" />
    <circle cx="12" cy="12.5" r="1.5" />
    <path d="M4 5v6M12 11V6.5A2 2 0 0 0 10 4.5H7.5M9 3l-1.5 1.5L9 6" />
  </Icon>
);

export const GripIcon = (p: IconProps) => (
  <Icon {...p} stroke="none" fill="currentColor">
    <circle cx="6" cy="4" r="1.1" />
    <circle cx="10" cy="4" r="1.1" />
    <circle cx="6" cy="8" r="1.1" />
    <circle cx="10" cy="8" r="1.1" />
    <circle cx="6" cy="12" r="1.1" />
    <circle cx="10" cy="12" r="1.1" />
  </Icon>
);

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c.6-2.4 2.6-4 5-4s4.4 1.6 5 4" />
  </Icon>
);

export const ColumnsIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6 3v10M10 3v10" />
  </Icon>
);

export const RewriteIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4h7M2.5 8h5M2.5 12h7" />
    <path d="M12.5 3v10M11 11.5l1.5 1.5 1.5-1.5M11 4.5L12.5 3 14 4.5" />
  </Icon>
);


/** The app icon's tile: a rounded square with continuous (Apple-style) corners. */
const LOGO_TILE = "M924 512C924 922 922 924 512 924C102 924 100 922 100 512C100 102 102 100 512 100C922 100 924 102 924 512Z";

/**
 * Tributary's logo, drawn like the app icon (tools/icons/draw.py): five branches in the
 * graph's colours flow in from above and merge into one commit, and one river flows on, in
 * the theme's colours (dark on light, white on dark). With `tile`, it's the whole app icon;
 * without, just the mark.
 */
export function Logo({ size = 32, tile = false }: { size?: number; tile?: boolean }) {
  const id = useId().replace(/:/g, "");
  const lanes: [number, string][] = [
    [200, "#1fb5ff"],
    [356, "#ff4f9a"],
    [512, "#ffad1f"],
    [668, "#2fd38a"],
    [824, "#8f6bff"],
  ];
  const lane = (x: number) => `M${x} 20V320C${x} 520 512 510 512 690`;
  const mark = (
    <>
      <path d="M450 690L418 1060H606L574 690Z" style={{ fill: "var(--logo-ink)" }} />
      <g fill="none" strokeLinecap="round">
        {/* Outer lanes first, the middle one last, so they overlap evenly where they meet. */}
        {[0, 4, 1, 3, 2].map((i) => (
          <path key={i} d={lane(lanes[i][0])} stroke={lanes[i][1]} strokeWidth={86} />
        ))}
      </g>
      <circle cx="512" cy="690" r="92" style={{ fill: "var(--logo-ink)" }} />
      <circle cx="512" cy="690" r="36" style={{ fill: "var(--logo-dot)" }} />
    </>
  );
  if (!tile) {
    return (
      <svg width={size} height={size} viewBox="150 150 724 724" aria-hidden="true">
        {mark}
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" aria-hidden="true" className="logo-tile">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" style={{ stopColor: "var(--logo-tile-top)" }} />
          <stop offset="1" style={{ stopColor: "var(--logo-tile-bottom)" }} />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d={LOGO_TILE} />
        </clipPath>
      </defs>
      <path d={LOGO_TILE} fill={`url(#${id}-bg)`} />
      <g clipPath={`url(#${id}-clip)`}>{mark}</g>
      <path d={LOGO_TILE} fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="5" />
    </svg>
  );
}

/** An open padlock. */
export const UnlockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" />
  </Icon>
);

/** A page with a clock: the history of a file. */
export const FileHistoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.5 14H4.5A1.5 1.5 0 0 1 3 12.5v-9A1.5 1.5 0 0 1 4.5 2h4l3.5 3.5V7" />
    <path d="M8.5 2v3.5H12" />
    <circle cx="11.5" cy="11.5" r="3" />
    <path d="M11.5 10v1.5l1 .8" />
  </Icon>
);

/** A cog, for settings. */
export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06M12.42 12.42l-1.06-1.06M4.64 4.64 3.58 3.58" />
    <circle cx="8" cy="8" r="4.25" />
  </Icon>
);

/** A bell, for notifications. */
export const BellIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1H3z" />
    <path d="M6.75 14a1.4 1.4 0 0 0 2.5 0" />
  </Icon>
);

/** An arrow down onto a line: download (an update). */
export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7" />
    <path d="M3 13.5h10" />
  </Icon>
);

/** The Windows title bar's buttons: thin lines on a 10×10 grid, like the system's own. */
function WindowGlyph({ children }: { children: React.ReactNode }) {
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1} aria-hidden="true" shapeRendering="crispEdges">
      {children}
    </svg>
  );
}
export const MinimizeGlyph = () => (
  <WindowGlyph>
    <path d="M0 5.5h10" />
  </WindowGlyph>
);
export const MaximizeGlyph = () => (
  <WindowGlyph>
    <rect x="0.5" y="0.5" width="9" height="9" />
  </WindowGlyph>
);
export const RestoreGlyph = () => (
  <WindowGlyph>
    <rect x="0.5" y="2.5" width="7" height="7" />
    <path d="M2.5 2.5V0.5h7v7h-2" />
  </WindowGlyph>
);
export const CloseGlyph = () => (
  <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1} aria-hidden="true">
    <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
  </svg>
);

/** A triangle with an exclamation mark. */
export const WarningIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.2 14.2 13H1.8z" />
    <path d="M8 6.5v3" />
    <path d="M8 11.4v.1" />
  </Icon>
);

/** A curved arrow going back: undo, recover. */
export const RecoverIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6.5h6a3.5 3.5 0 0 1 0 7H6" />
    <path d="M6.5 4 4 6.5 6.5 9" />
  </Icon>
);

/** A crossed-out eye-less circle: ignore a file. */
export const IgnoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="m4.2 11.8 7.6-7.6" />
  </Icon>
);

/** Several lines pressed into one: a squash merge. */
export const SquashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 2.5 8 6l4-3.5" />
    <path d="M4 13.5 8 10l4 3.5" />
    <path d="M3 8h10" />
  </Icon>
);

/** A file's changes: a page with a plus and a minus. */
export const DiffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" />
    <path d="M8.5 5v4M6.5 7h4M6.5 11.5h4" />
  </Icon>
);

/** A submodule: a repository inside another, as a box inside a box. */
export const SubmoduleIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2" />
    <rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1" />
  </Icon>
);
