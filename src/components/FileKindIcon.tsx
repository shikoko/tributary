import type { SVGProps } from "react";
import { fileKind, KIND_LABELS, type FileKind } from "../lib/fileKinds";

/** The outline of a page with a folded corner, shared by the plainer kinds. */
const PAGE = "M4 1.75h5.25l2.75 3v9.5H4z M9.25 1.75v3H12";

/** Each kind's drawing, in the app's 16×16 line style. */
const SHAPES: Record<FileKind, string> = {
  image: "M2.25 3.25h11.5v9.5H2.25z M2.25 10.75l3.25-3.25 2.5 2.5 1.75-1.75 4 3.5 M10.5 5.5a.9.9 0 1 0 0 .01",
  audio: "M6 12V3.25l7-1.5V10.5 M6 12a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0z M13 10.5a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0z",
  video: "M2.25 3.25h11.5v9.5H2.25z M6.75 5.75v4.5L10.5 8z",
  model: "M8 1.75l5.5 3v6.5L8 14.25l-5.5-3v-6.5z M2.5 4.75L8 7.75l5.5-3 M8 7.75v6.5",
  engine: "M8 1.75l5.5 3.1v6.3L8 14.25l-5.5-3.1v-6.3z M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  code: "M5.5 4.5L2 8l3.5 3.5 M10.5 4.5L14 8l-3.5 3.5 M9 3l-2 10",
  data: "M6 2.5c-1.5 0-2 .75-2 2v1.5c0 1-.5 1.5-1.5 2 1 .5 1.5 1 1.5 2v1.5c0 1.25.5 2 2 2 M10 2.5c1.5 0 2 .75 2 2v1.5c0 1 .5 1.5 1.5 2-1 .5-1.5 1-1.5 2v1.5c0 1.25-.5 2-2 2",
  text: `${PAGE} M6 7.75h4 M6 10h4 M6 12.25h2.5`,
  archive: "M2.5 5.25h11v8.5h-11z M1.75 2.25h12.5v3H1.75z M6.5 8h3",
  font: "M3 13.5L7 2.75h2L13 13.5 M4.75 9.25h6.5",
  program: "M4.25 4.25h7.5v7.5h-7.5z M6.5 1.75v2.5 M9.5 1.75v2.5 M6.5 11.75v2.5 M9.5 11.75v2.5 M1.75 6.5h2.5 M1.75 9.5h2.5 M11.75 6.5h2.5 M11.75 9.5h2.5",
  folder: "M1.75 3.75h4.5l1.5 1.5h6.5v7.5H1.75z",
  file: PAGE,
};

/** A small, muted icon for the kind of file at `path`, named in its tooltip. */
export function FileKindIcon({ path, size = 13, ...props }: { path: string; size?: number } & SVGProps<SVGSVGElement>) {
  const kind = fileKind(path);
  return (
    <svg
      className={`file-kind ${kind}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={KIND_LABELS[kind]}
      {...props}
    >
      <title>{KIND_LABELS[kind]}</title>
      <path d={SHAPES[kind]} />
    </svg>
  );
}
