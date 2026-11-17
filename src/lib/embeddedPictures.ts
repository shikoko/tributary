import type { DiffLine, Hunk } from "../api";
import type { Piece } from "./syntax";

/**
 * Pictures written into text files: `data:` URLs in CSS, HTML, SVG, JSON or Markdown, and
 * the outputs Jupyter keeps in a notebook. A text diff shows them as a wall of letters;
 * found here, they can be shown as the pictures they are.
 */

/** One picture in a line of text. */
export interface EmbeddedPicture {
  /** Its type, like "image/png". */
  type: string;
  /** A `data:` URL a picture can be drawn from. */
  url: string;
  /** How big the picture is, in bytes. */
  bytes: number;
  /** Where it is in the line: the text from `start` to `end` is the picture. */
  start: number;
  end: number;
}

/** A picture that changed: before and after (null where it wasn't there, or is gone). */
export interface PictureChange {
  before: (EmbeddedPicture & { line: number }) | null;
  after: (EmbeddedPicture & { line: number }) | null;
  /** The hunk it's in, and the index of the line after which it can be shown. */
  hunk: number;
  last: number;
}

/** Pictures shorter than this in base64 are left as text (too small to be worth a picture). */
const SHORTEST = 24;

const TYPES = "png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\\.microsoft\\.icon|svg\\+xml";
/** `data:image/png;base64,iVBOR…`, with `;charset=…` or other parameters before `;base64`. */
const BASE64_URL = new RegExp(`data:(image/(?:${TYPES}))((?:;[a-z-]+=[^;,"')\\s]+)*);base64,([A-Za-z0-9+/]+={0,2})`, "gi");
/** `data:image/svg+xml,%3Csvg…` or `data:image/svg+xml;utf8,%3Csvg…`, as CSS often has it. */
const ENCODED_SVG = /data:image\/svg\+xml((?:;[a-z0-9-]+(?:=[^;,"')\s]+)?)*),(%3Csvg[^"')\s]*)/gi;
/** A notebook's output: `"image/png": "iVBOR…\n"` (in JSON, with the newline written out). */
const NOTEBOOK = /"(image\/(?:png|jpeg|gif|webp))"\s*:\s*"([A-Za-z0-9+/]+={0,2})(?:\\n)?"/g;

/** How many bytes a stretch of base64 holds. */
function base64Bytes(text: string): number {
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return Math.floor((text.length * 3) / 4) - padding;
}

/** The pictures in a line of text, in order. */
export function picturesIn(text: string): EmbeddedPicture[] {
  if (!text.includes("image/")) return [];
  const found: EmbeddedPicture[] = [];
  for (const match of text.matchAll(BASE64_URL)) {
    const data = match[3];
    if (data.length < SHORTEST) continue;
    const type = match[1].toLowerCase();
    found.push({ type, url: `data:${type};base64,${data}`, bytes: base64Bytes(data), start: match.index, end: match.index + match[0].length });
  }
  for (const match of text.matchAll(ENCODED_SVG)) {
    let svg: string;
    try {
      svg = decodeURIComponent(match[2]);
    } catch {
      continue;
    }
    found.push({ type: "image/svg+xml", url: `data:image/svg+xml,${match[2]}`, bytes: new TextEncoder().encode(svg).length, start: match.index, end: match.index + match[0].length });
  }
  for (const match of text.matchAll(NOTEBOOK)) {
    const data = match[2];
    if (data.length < SHORTEST) continue;
    // Only the base64: the type's key and the quotes stay text.
    const start = match.index + match[0].indexOf(data, match[1].length + 2);
    found.push({ type: match[1], url: `data:${match[1]};base64,${data}`, bytes: base64Bytes(data), start, end: start + data.length });
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * The pictures that changed in `hunks`. In each run of changed lines, the pictures taken
 * out are paired, in order, with the ones put in; one that's on both sides as it was (its
 * line changed around it) isn't a change.
 */
export function changedPictures(hunks: Hunk[]): PictureChange[] {
  const changes: PictureChange[] = [];
  hunks.forEach((hunk, hunkIndex) => {
    let removed: { picture: EmbeddedPicture; line: DiffLine }[] = [];
    let added: { picture: EmbeddedPicture; line: DiffLine }[] = [];
    let last = -1;
    const flush = () => {
      const kept = new Set(removed.map(({ picture }) => picture.url).filter((url) => added.some(({ picture }) => picture.url === url)));
      const before = removed.filter(({ picture }) => !kept.has(picture.url));
      const after = added.filter(({ picture }) => !kept.has(picture.url));
      for (let i = 0; i < Math.max(before.length, after.length); i++) {
        const was = before[i];
        const now = after[i];
        changes.push({
          before: was ? { ...was.picture, line: was.line.old ?? 0 } : null,
          after: now ? { ...now.picture, line: now.line.new ?? 0 } : null,
          hunk: hunkIndex,
          last,
        });
      }
      removed = [];
      added = [];
    };
    hunk.lines.forEach((line, index) => {
      if (line.kind === "context") {
        flush();
        return;
      }
      last = index;
      const pictures = picturesIn(line.text).map((picture) => ({ picture, line }));
      if (line.kind === "removed") removed.push(...pictures);
      else added.push(...pictures);
    });
    flush();
  });
  return changes;
}

/** "PNG", "SVG", "JPEG"…: a picture type as people say it. */
export function pictureFormat(type: string): string {
  const name = type.replace(/^image\//, "").replace(/\+xml$/, "");
  if (name === "x-icon" || name === "vnd.microsoft.icon") return "ICO";
  return name === "jpg" ? "JPEG" : name.toUpperCase();
}

/** An SVG's text, from a `data:` URL (base64, or written out with % escapes). */
export function svgText(url: string): string | null {
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  const head = url.slice(0, comma);
  const body = url.slice(comma + 1);
  try {
    if (head.endsWith(";base64")) {
      const binary = atob(body);
      return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    }
    return decodeURIComponent(body);
  } catch {
    return null;
  }
}

/**
 * How big an SVG says it is, width and height, from its `width` and `height` (in pixels)
 * or else its `viewBox`. Browsers say 300 × 150 for one without a size of its own.
 */
export function svgSize(text: string): [number, number] | null {
  const root = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!root) return null;
  const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(root)?.[1].trim() ?? null;
  const pixels = (value: string | null) => {
    const match = value ? /^(\d+(?:\.\d+)?)(px)?$/.exec(value) : null;
    return match ? Number(match[1]) : null;
  };
  const width = pixels(attribute("width"));
  const height = pixels(attribute("height"));
  const box = attribute("viewBox")
    ?.split(/[\s,]+/)
    .map(Number)
    .slice(2, 4);
  const [boxWidth, boxHeight] = box && box.length === 2 && box.every((n) => Number.isFinite(n) && n > 0) ? box : [null, null];
  if (width && height) return [width, height];
  if (boxWidth && boxHeight) {
    // One of the two given: the other follows the viewBox's shape.
    if (width) return [width, (width * boxHeight) / boxWidth];
    if (height) return [(height * boxWidth) / boxHeight, height];
    return [boxWidth, boxHeight];
  }
  return null;
}

/** A piece of a line, or a picture in it folded into one piece (its text is a label). */
export type Folded = Piece & { picture?: EmbeddedPicture };

/** "PNG picture · 250 bytes": what a folded picture says instead of its letters. */
export function pictureLabel(picture: EmbeddedPicture, bytes: (count: number) => string): string {
  return `${pictureFormat(picture.type)} picture · ${bytes(picture.bytes)}`;
}

/**
 * A line's pieces (coloured by syntax, changed words marked) with each of `pictures` in it
 * folded into one piece, labelled by `label`: the letters around them stay as they were.
 */
export function foldPictures(parts: Piece[], pictures: EmbeddedPicture[], label: (picture: EmbeddedPicture) => string): Folded[] {
  if (pictures.length === 0) return parts;
  const out: Folded[] = [];
  const folded = new Set<EmbeddedPicture>();
  let at = 0;
  for (const part of parts) {
    const start = at;
    const end = at + part.text.length;
    at = end;
    let from = start;
    while (from < end) {
      const inside = pictures.find((picture) => picture.start <= from && from < picture.end);
      if (inside) {
        if (!folded.has(inside)) {
          folded.add(inside);
          out.push({ text: label(inside), className: null, changed: false, picture: inside });
        }
        from = Math.min(end, inside.end);
        continue;
      }
      const next = pictures.find((picture) => picture.start > from && picture.start < end);
      const stop = next ? next.start : end;
      out.push({ ...part, text: part.text.slice(from - start, stop - start) });
      from = stop;
    }
  }
  return out;
}
