/**
 * Markdown, as GitHub and GitLab write it in pull requests and comments, read into
 * blocks and inline pieces for React to show (never as HTML, so nothing in it can run).
 * Covers what people write there: paragraphs (a line break is a break), headings, lists
 * (nested, numbered, with task boxes), quotes, code, tables, rules, emphasis, links and
 * bare addresses. HTML comments, like a template's hints, are left out.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "break" }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em" | "del"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] };

export interface ListItem {
  /** A task box: ticked or not; null for an ordinary item. */
  checked: boolean | null;
  blocks: Block[];
}

export type Block =
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "heading"; level: number; content: Inline[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

interface Marker {
  indent: number;
  ordered: boolean;
  start: number;
  text: string;
  /** Where the item's own text starts: lines indented this far belong to it. */
  content: number;
}

function listMarker(line: string): Marker | null {
  const found = line.match(/^(\s*)([-*+]|(\d{1,9})[.)])(\s+)(.*)$/);
  if (!found) return null;
  return {
    indent: found[1].length,
    ordered: found[3] !== undefined,
    start: found[3] !== undefined ? Number(found[3]) : 1,
    text: found[5],
    content: found[1].length + found[2].length + Math.min(found[4].length, 4),
  };
}

const indentOf = (line: string) => line.length - line.trimStart().length;

/** Whether a line begins a block of its own (and so ends a paragraph). */
function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || listMarker(line) !== null;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => parseInline(cell.trim()));

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const indent = indentOf(line);
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) {
        body.push(lines[i].slice(Math.min(indent, indentOf(lines[i]))));
        i++;
      }
      i++;
      blocks.push({ kind: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, content: parseInline(heading[2]) });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !startsBlock(lines[i]))) {
        quoted.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", blocks: parseBlocks(quoted) });
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const items: { checked: boolean | null; lines: string[] }[] = [];
      const sameList = (found: Marker | null) => found !== null && found.ordered === marker.ordered && found.indent <= marker.indent + 1;
      while (i < lines.length) {
        const current = lines[i];
        const found = listMarker(current);
        if (sameList(found)) {
          const task = found!.text.match(/^\[([ xX])\]\s+(.*)$/);
          items.push({ checked: task ? task[1] !== " " : null, lines: [task ? task[2] : found!.text] });
          i++;
          continue;
        }
        const item = items[items.length - 1];
        if (!current.trim()) {
          // A blank line ends the list, unless what follows is another item or belongs to this one.
          let next = i + 1;
          while (next < lines.length && !lines[next].trim()) next++;
          if (next < lines.length && (sameList(listMarker(lines[next])) || indentOf(lines[next]) >= marker.content)) {
            item.lines.push("");
            i++;
            continue;
          }
          break;
        }
        if (indentOf(current) > marker.indent + 1) {
          // Indented under the item: more of it, or a list inside it.
          item.lines.push(current.slice(Math.min(indentOf(current), marker.content)));
          i++;
          continue;
        }
        if (!startsBlock(current)) {
          // A line that carries on the item's text.
          item.lines.push(current.trim());
          i++;
          continue;
        }
        break;
      }
      blocks.push({
        kind: "list",
        ordered: marker.ordered,
        start: marker.start,
        items: items.map((item) => ({ checked: item.checked, blocks: parseBlocks(item.lines) })),
      });
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(cells(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && (paragraph.length === 0 || !startsBlock(lines[i]))) {
      paragraph.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: "paragraph", content: parseInline(paragraph.join("\n")) });
  }
  return blocks;
}

/**
 * Without its HTML comments (a template's hints, say), as GitHub shows it: taken out until
 * none are left (taking one out can join the pieces of another), and one left open hides the
 * rest. Nothing here is ever shown as HTML, but no "<!--" is left either way.
 */
export function withoutComments(text: string): string {
  let result = text;
  for (let before = ""; before !== result; ) {
    before = result;
    result = result.replace(/<!--[\s\S]*?-->/g, "");
  }
  const open = result.indexOf("<!--");
  return open < 0 ? result : result.slice(0, open);
}

/** Markdown text, read into blocks. */
export function parseMarkdown(text: string): Block[] {
  const source = withoutComments(text.replace(/\r\n?/g, "\n"));
  return parseBlocks(source.split("\n"));
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~|>]/;
const WORD = /[\p{L}\p{N}]/u;

/** The pieces of one paragraph (or heading, or table cell). */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (!plain) return;
    plain.split("\n").forEach((part, index) => {
      if (index > 0) out.push({ kind: "break" });
      if (part) out.push({ kind: "text", text: part });
    });
    plain = "";
  };
  const push = (piece: Inline) => {
    flush();
    out.push(piece);
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const rest = text.slice(i);
    const before = text[i - 1] ?? "";
    let found: RegExpMatchArray | null;

    if (c === "\\" && ESCAPABLE.test(text[i + 1] ?? "")) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (c === "`" && (found = rest.match(/^(`+)([\s\S]*?[^`])\1(?!`)/))) {
      const code = found[2].replace(/\n/g, " ");
      push({ kind: "code", text: /^ .* $/.test(code) ? code.slice(1, -1) : code });
      i += found[0].length;
      continue;
    }
    if ((c === "*" || c === "_") && (found = rest.match(c === "*" ? /^\*\*(?=\S)([\s\S]*?\S)\*\*/ : /^__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}])/u))) {
      if (c === "*" || !WORD.test(before)) {
        push({ kind: "strong", children: parseInline(found[1]) });
        i += found[0].length;
        continue;
      }
    }
    if (c === "~" && (found = rest.match(/^~~(?=\S)([\s\S]*?\S)~~/))) {
      push({ kind: "del", children: parseInline(found[1]) });
      i += found[0].length;
      continue;
    }
    if ((c === "*" || c === "_") && (found = rest.match(c === "*" ? /^\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/ : /^_(?=[^\s_])([\s\S]*?[^\s_])_(?![\p{L}\p{N}_])/u))) {
      if (c === "*" || !WORD.test(before)) {
        push({ kind: "em", children: parseInline(found[1]) });
        i += found[0].length;
        continue;
      }
    }
    if (c === "!" && (found = rest.match(/^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/))) {
      push({ kind: "link", href: found[2], children: [{ kind: "text", text: found[1] || "Image" }] });
      i += found[0].length;
      continue;
    }
    if (c === "[" && (found = rest.match(/^\[((?:[^[\]]|\[[^\]]*\])+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/))) {
      push({ kind: "link", href: found[2], children: parseInline(found[1]) });
      i += found[0].length;
      continue;
    }
    if (c === "<" && (found = rest.match(/^<((?:https?:\/\/|mailto:)[^>\s]+)>/))) {
      push({ kind: "link", href: found[1], children: [{ kind: "text", text: found[1].replace(/^mailto:/, "") }] });
      i += found[0].length;
      continue;
    }
    if (c === "h" && !WORD.test(before) && (found = rest.match(/^https?:\/\/[^\s<]*[^\s<.,:;"')\]!?*_~]/))) {
      push({ kind: "link", href: found[0], children: [{ kind: "text", text: found[0] }] });
      i += found[0].length;
      continue;
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}

/** Whether a link can be opened (in the browser): web and email addresses only. */
export function openable(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}
