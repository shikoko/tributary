// TERMS.txt as rich text, for the licence pages of the Windows installers (the .msi's needs
// RTF; the .exe's shows it too, when it runs with its own pages).
//
//   node tools/terms-rtf.mjs <out.rtf>
import { readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) {
  console.error("Usage: node tools/terms-rtf.mjs <out.rtf>");
  process.exit(1);
}
const text = readFileSync(new URL("../TERMS.txt", import.meta.url), "utf8").trim();
// RTF's own characters escaped; anything outside ASCII as a Unicode escape.
const escape = (line) =>
  line.replace(/[\\{}]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0) > 32767 ? c.charCodeAt(0) - 65536 : c.charCodeAt(0)}?`);
const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.replace(/\s*\n\s*/g, " "));
const body = paragraphs
  .map((paragraph, index) => {
    if (index === 0) return `{\\b\\fs26 ${escape(paragraph)}}\\par\\par`;
    if (paragraph === "The MIT licence") return `{\\b ${escape(paragraph)}}\\par\\par`;
    // A numbered point starts in bold, as in the setup window.
    const point = paragraph.match(/^(\d+\.\s+[^.]+\.)(.*)$/);
    return `${point ? `{\\b ${escape(point[1])}}${escape(point[2])}` : escape(paragraph)}\\par\\par`;
  })
  .join("\n");
writeFileSync(out, `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Segoe UI;}}\\f0\\fs18\n${body}\n}\n`);
console.log(`Wrote ${out}`);
