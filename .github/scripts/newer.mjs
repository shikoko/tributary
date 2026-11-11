// Whether one version is newer than another, as the updater compares them (semver: a beta
// comes before its release, 0.3.0-beta.9 before 0.3.0-beta.10, and both before 0.3.0).
//
//   node .github/scripts/newer.mjs <version> <than>   exits 0 if <version> is newer, 1 if not
//
// Either may start with a v. An empty <than> (nothing to compare with) counts as older.

/** Below zero if a comes first, above if b does, zero if they're the same version. */
export function compare(a, b) {
  const parse = (version) => {
    const [core, pre] = version.replace(/^v/, "").split("+")[0].split(/-(.*)/s);
    return { core: core.split(".").map(Number), pre: pre ? pre.split(".") : [] };
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return (x.core[i] ?? 0) - (y.core[i] ?? 0);
  // A version without a pre-release part comes after one with.
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const [m, n] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (m && n) return Number(p) - Number(q);
    if (m !== n) return m ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [version, than] = process.argv.slice(2);
  process.exit(!than || compare(version, than) > 0 ? 0 : 1);
}
