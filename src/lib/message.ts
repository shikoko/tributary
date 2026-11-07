/** A piece of a commit message's body, laid out for reading. */
export type BodyBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "item"; depth: number; marker: string; text: string }
  | { kind: "code"; text: string };

const ITEM = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
/** "Co-authored-by: …", "Signed-off-by: …", "Closes: #12". */
const TRAILER = /^[A-Za-z][\w-]*:\s/;

function indentOf(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

/** Remove the indentation the lines have in common. */
function dedent(lines: string[]): string {
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const common = Math.min(...lines.filter((line) => line.trim()).map(indentOf));
  return lines.map((line) => line.slice(Math.min(common, indentOf(line)))).join("\n");
}

/**
 * Commit messages are usually wrapped by hand at about 72 characters. Shown as written in a
 * panel of another width, those breaks land mid-sentence. This joins the wrapped lines back
 * into paragraphs and list items, so the panel can wrap them itself.
 *
 * Indented blocks (4 or more spaces after a blank line), fenced blocks and trailers like
 * "Co-authored-by:" keep their lines exactly as written.
 */
export function reflowBody(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  /** The paragraph being collected, line by line (joined at the end, unless it's trailers). */
  let paragraph: string[] | null = null;
  let item: Extract<BodyBlock, { kind: "item" }> | null = null;
  let code: string[] | null = null;
  let fence: string[] | null = null;

  const endParagraph = () => {
    if (!paragraph) return;
    if (paragraph.length > 1 && paragraph.every((line) => TRAILER.test(line))) {
      for (const line of paragraph) blocks.push({ kind: "paragraph", text: line });
    } else {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    }
    paragraph = null;
  };
  const endCode = () => {
    if (code) blocks.push({ kind: "code", text: dedent(code) });
    code = null;
  };
  const endAll = () => {
    endParagraph();
    endCode();
    item = null;
  };

  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (fence) {
      if (FENCE.test(line)) {
        blocks.push({ kind: "code", text: fence.join("\n") });
        fence = null;
      } else {
        fence.push(raw);
      }
      continue;
    }
    if (FENCE.test(line)) {
      endAll();
      fence = [];
      continue;
    }
    if (!line.trim()) {
      endParagraph();
      item = null;
      // A blank line inside an indented block belongs to it, if the block goes on.
      if (code) code.push("");
      continue;
    }
    const indent = indentOf(line);
    const listItem = ITEM.exec(line);
    if (listItem && !code) {
      endParagraph();
      item = {
        kind: "item",
        depth: Math.min(3, Math.floor(indentOf(listItem[1]) / 2)),
        marker: /\d/.test(listItem[2]) ? listItem[2] : "•",
        text: listItem[3].trim(),
      };
      blocks.push(item);
      continue;
    }
    if (item) {
      // A wrapped list item, whatever its indentation.
      item.text += ` ${line.trim()}`;
      continue;
    }
    if (code || (!paragraph && indent >= 4)) {
      if (indent >= 4 || !code) {
        endParagraph();
        (code ??= []).push(raw);
        continue;
      }
      endCode();
    }
    (paragraph ??= []).push(line.trim());
  }
  if (fence) blocks.push({ kind: "code", text: (fence as string[]).join("\n") });
  endAll();
  return blocks;
}
