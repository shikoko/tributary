// Colouring code by its syntax (keywords, strings, comments, …) in diffs, blame and the
// conflict editor, with highlight.js and the languages people commonly keep in git.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import glsl from "highlight.js/lib/languages/glsl";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { DiffLine } from "../api";
import type { Segment } from "./wordDiff";

const LANGUAGES = { bash, c, cpp, csharp, css, dockerfile, glsl, go, ini, java, javascript, json, kotlin, lua, makefile, markdown, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml };
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);

/** File extensions (and a few whole names) and their languages. */
const BY_EXTENSION: Record<string, keyof typeof LANGUAGES> = {
  sh: "bash", bash: "bash", zsh: "bash",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", inl: "cpp", ino: "cpp",
  cs: "csharp",
  css: "css",
  glsl: "glsl", vert: "glsl", frag: "glsl", usf: "cpp", ush: "cpp", hlsl: "cpp", shader: "cpp",
  go: "go",
  ini: "ini", toml: "ini", cfg: "ini", conf: "ini", editorconfig: "ini", uproject: "json", uplugin: "json",
  java: "java",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  json: "json", jsonc: "json",
  kt: "kotlin", kts: "kotlin",
  lua: "lua",
  md: "markdown", markdown: "markdown",
  php: "php",
  py: "python", pyw: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss", sass: "scss", less: "scss",
  sql: "sql",
  swift: "swift",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", xaml: "xml", plist: "xml", csproj: "xml", vue: "xml",
  yml: "yaml", yaml: "yaml",
};
const BY_NAME: Record<string, keyof typeof LANGUAGES> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  ".gitconfig": "ini",
  ".gitmodules": "ini",
  ".bashrc": "bash",
  ".zshrc": "bash",
};

/** The language to colour `path` as, or null for files that aren't code (or not one we know). */
export function languageFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? (BY_EXTENSION[name.slice(dot + 1)] ?? null) : null;
}

/** A piece of a line in one colour: highlight.js's classes (like "hljs-keyword"), or none. */
export interface Token {
  text: string;
  className: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'", "#39": "'" };

/** highlight.js's HTML (spans and escaped text) as lines of tokens. */
export function tokensFromHtml(html: string): Token[][] {
  const lines: Token[][] = [[]];
  const classes: string[] = [];
  const pattern = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
  for (const match of html.matchAll(pattern)) {
    if (match[1] !== undefined) {
      classes.push(match[1]);
    } else if (match[0] === "</span>") {
      classes.pop();
    } else {
      const text = match[2].replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, entity: string) => ENTITIES[entity]);
      const className = classes.length > 0 ? classes[classes.length - 1] : null;
      text.split("\n").forEach((part, index) => {
        if (index > 0) lines.push([]);
        if (part) lines[lines.length - 1].push({ text: part, className });
      });
    }
  }
  return lines;
}

/** Colour `code` as `language`: its tokens, line by line (null if it can't be). */
export function highlightCode(code: string, language: string | null): Token[][] | null {
  if (!language || !hljs.getLanguage(language)) return null;
  try {
    return tokensFromHtml(hljs.highlight(code, { language, ignoreIllegals: true }).value);
  } catch {
    return null;
  }
}

/** Hunks longer than this together aren't coloured (it would take a moment). */
export const MAX_HIGHLIGHT_LINES = 8000;

/**
 * The tokens of each line of a hunk. The lines before the change (unchanged and removed)
 * and after it (unchanged and added) are coloured as two whole pieces of code, so strings
 * and comments over several lines come out right.
 */
export function highlightHunk(lines: DiffLine[], language: string | null): (Token[] | null)[] {
  const none = lines.map(() => null);
  if (!language) return none;
  const before = lines.filter((line) => line.kind !== "added");
  const after = lines.filter((line) => line.kind !== "removed");
  const old = highlightCode(before.map((line) => line.text).join("\n"), language);
  const now = highlightCode(after.map((line) => line.text).join("\n"), language);
  if (!old || !now) return none;
  let [o, n] = [0, 0];
  return lines.map((line) => {
    if (line.kind === "removed") return old[o++] ?? null;
    if (line.kind === "added") return now[n++] ?? null;
    o++;
    return now[n++] ?? null;
  });
}

/** One piece of a line to draw: its text, its colour, and whether it's part of the change. */
export interface Piece {
  text: string;
  className: string | null;
  changed: boolean;
}

/** A line's syntax tokens and its changed-word segments (either can be missing), as pieces. */
export function pieces(text: string, tokens: Token[] | null, segments: Segment[] | null): Piece[] {
  // Tokens that don't add up to the line (they always should) aren't used.
  const fits = tokens !== null && tokens.length > 0 && tokens.reduce((sum, token) => sum + token.text.length, 0) === text.length;
  const colours = fits ? tokens : [{ text, className: null }];
  const marks = segments && segments.length > 0 ? segments : [{ text, changed: false }];
  const result: Piece[] = [];
  let [t, m, tOffset, mOffset] = [0, 0, 0, 0];
  while (t < colours.length && m < marks.length) {
    const token = colours[t];
    const mark = marks[m];
    const length = Math.min(token.text.length - tOffset, mark.text.length - mOffset);
    if (length > 0) {
      const piece = token.text.slice(tOffset, tOffset + length);
      const last = result[result.length - 1];
      if (last && last.className === token.className && last.changed === mark.changed) last.text += piece;
      else result.push({ text: piece, className: token.className, changed: mark.changed });
    }
    tOffset += length;
    mOffset += length;
    if (tOffset >= token.text.length) [t, tOffset] = [t + 1, 0];
    if (mOffset >= mark.text.length) [m, mOffset] = [m + 1, 0];
  }
  return result;
}
