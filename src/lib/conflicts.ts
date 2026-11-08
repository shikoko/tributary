// A conflicted file's text, split into what merged cleanly and the conflicts git marked:
//
//   <<<<<<< HEAD
//   your lines
//   ||||||| base        (only with merge.conflictStyle diff3 or zdiff3)
//   the lines before either change
//   =======
//   their lines
//   >>>>>>> feature
//
// Each conflict is resolved with a choice, and the file is put back together from them.

export interface Conflict {
  kind: "conflict";
  /** Your side's lines and theirs, each with its line endings. */
  ours: string;
  theirs: string;
  /** What it was before either change, when git wrote it. */
  base: string | null;
  /** What git called the sides, like "HEAD" and "feature". */
  oursLabel: string;
  theirsLabel: string;
}

export type Segment = { kind: "text"; text: string } | Conflict;

/** Mine, theirs, both (in either order), or text written in the app. */
export type Choice = "ours" | "theirs" | "ours-then-theirs" | "theirs-then-ours" | { text: string };

/** The lines of `text`, each with its line ending ("\n" or "\r\n", none for a last line without one). */
function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Whether `line` is a conflict marker made of `char` (seven of them, then a space or the end). */
function isMarker(line: string, char: string): boolean {
  const marker = char.repeat(7);
  if (!line.startsWith(marker)) return false;
  const rest = line.slice(7);
  return rest === "" || rest.startsWith(" ") || rest.startsWith("\n") || rest.startsWith("\r");
}

const label = (line: string) => line.slice(8).trim();

/** Split `text` into clean stretches and conflicts; null when its markers don't add up. */
export function parseConflicts(text: string): Segment[] | null {
  const segments: Segment[] = [];
  let clean = "";
  let current: { part: "ours" | "base" | "theirs"; conflict: Conflict } | null = null;
  for (const line of linesOf(text)) {
    if (!current) {
      if (isMarker(line, "<")) {
        if (clean) segments.push({ kind: "text", text: clean });
        clean = "";
        current = { part: "ours", conflict: { kind: "conflict", ours: "", theirs: "", base: null, oursLabel: label(line), theirsLabel: "" } };
      } else if (isMarker(line, "=") || isMarker(line, ">") || isMarker(line, "|")) {
        return null;
      } else {
        clean += line;
      }
      continue;
    }
    const { conflict } = current;
    if (isMarker(line, "|") && current.part === "ours") {
      current.part = "base";
      conflict.base = "";
    } else if (isMarker(line, "=") && current.part !== "theirs") {
      current.part = "theirs";
    } else if (isMarker(line, ">") && current.part === "theirs") {
      conflict.theirsLabel = label(line);
      segments.push(conflict);
      current = null;
    } else if (isMarker(line, "<")) {
      // Conflicts inside conflicts: leave them to a merge tool.
      return null;
    } else if (current.part === "ours") {
      conflict.ours += line;
    } else if (current.part === "base") {
      conflict.base += line;
    } else {
      conflict.theirs += line;
    }
  }
  if (current) return null;
  if (clean) segments.push({ kind: "text", text: clean });
  return segments;
}

export function conflictsIn(segments: Segment[]): Conflict[] {
  return segments.filter((segment): segment is Conflict => segment.kind === "conflict");
}

/** `first` then `second`, on separate lines even when `first` has no line ending. */
function join(first: string, second: string): string {
  if (!first || !second || first.endsWith("\n")) return first + second;
  return `${first}${first.includes("\r\n") ? "\r\n" : "\n"}${second}`;
}

/** What a conflict becomes with `choice`. */
export function resolveConflict(conflict: Conflict, choice: Choice): string {
  if (typeof choice === "object") return choice.text;
  switch (choice) {
    case "ours":
      return conflict.ours;
    case "theirs":
      return conflict.theirs;
    case "ours-then-theirs":
      return join(conflict.ours, conflict.theirs);
    case "theirs-then-ours":
      return join(conflict.theirs, conflict.ours);
  }
}

/** The whole file with each conflict resolved, or null while some aren't. */
export function resolvedText(segments: Segment[], choices: (Choice | undefined)[]): string | null {
  let text = "";
  let index = 0;
  for (const segment of segments) {
    if (segment.kind === "text") {
      text += segment.text;
      continue;
    }
    const choice = choices[index++];
    if (choice === undefined) return null;
    text += resolveConflict(segment, choice);
  }
  return text;
}
