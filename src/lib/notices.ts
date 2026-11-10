// The licences of the software Tributary is made with, from THIRD_PARTY_NOTICES.txt (which
// tools/notices.mjs writes): the packages each licence text covers, turned around into the
// texts each package comes with.

export interface NoticePackage {
  name: string;
  version: string;
  /** Its licence, as the package states it, like "MIT OR Apache-2.0". */
  license: string;
  /** Its repository or home page. */
  home: string;
  /** The licence files it comes with (none for the few that don't include one). */
  texts: string[];
}

const RULE = "=".repeat(78);
/** "name version (licence) home", one package per line. */
const PACKAGE = /^(\S+) (\S+) \((.*)\) (\S+)$/;

/** Every package in the notices, by name, with the licence texts that cover it. */
export function parseNotices(text: string): NoticePackage[] {
  const byKey = new Map<string, NoticePackage>();
  const chunks = text.replace(/\r\n/g, "\n").split(`\n${RULE}\n`).slice(1);
  for (const chunk of chunks) {
    const lines = chunk.replace(/^\n+/, "").split("\n");
    let at = 0;
    // A sentence before the packages (the ones that come without a licence file).
    if (lines[0] && !PACKAGE.test(lines[0])) {
      at = 1;
      while (lines[at] === "") at++;
    }
    const found: string[] = [];
    for (; at < lines.length && PACKAGE.test(lines[at]); at++) found.push(lines[at]);
    const body = lines.slice(at).join("\n").trim();
    for (const line of found) {
      const [, name, version, license, home] = PACKAGE.exec(line) ?? [];
      const key = `${name}@${version}`;
      let entry = byKey.get(key);
      if (!entry) byKey.set(key, (entry = { name, version, license, home, texts: [] }));
      if (body) entry.texts.push(body);
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }));
}

/** The packages whose name or licence has `query` in it. */
export function searchNotices(packages: NoticePackage[], query: string): NoticePackage[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return packages;
  return packages.filter((entry) => {
    const haystack = `${entry.name} ${entry.license}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
