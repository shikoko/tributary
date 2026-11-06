import type { SVGProps } from "react";

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

/** An arrow going back, for resetting. */
export const ResetIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 3.5 2.5 6.5l3 3" />
    <path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" />
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
export function Logo({ size = 32, outline = "#14161b" }: { size?: number; outline?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M48 10V20a9 9 0 0 1-9 9H32" stroke="#8ce04a" />
        <path d="M32 16V37a9 9 0 0 1-9 9H16" stroke="#ff4f9a" />
        <path d="M16 10V54" stroke="#1fb5ff" />
      </g>
      <g stroke={outline} strokeWidth="3">
        <circle cx="48" cy="10" r="6" fill="#8ce04a" />
        <circle cx="32" cy="16" r="6" fill="#ff4f9a" />
        <circle cx="16" cy="10" r="6" fill="#1fb5ff" />
        <circle cx="16" cy="54" r="6" fill="#1fb5ff" />
      </g>
    </svg>
  );
}
