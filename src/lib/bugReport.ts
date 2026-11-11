/** Where Tributary's bugs are reported. */
export const NEW_ISSUE = "https://github.com/shikoko/tributary/issues/new";

/** Past this, GitHub turns the address away: long text is cut to fit. */
const MAX_URL = 7000;

/** The bug report form's System choices. */
export type ReportSystem = "macOS" | "Windows" | "Linux (built from source)";

/**
 * A new bug report on GitHub, filled in: its title and the form's fields (by their ids in
 * .github/ISSUE_TEMPLATE/bug_report.yml), for the person to read, change and send there.
 * Nothing is sent by itself.
 */
export function bugReportUrl({ title, what, diagnostics, system }: { title?: string; what?: string; diagnostics?: string; system?: ReportSystem }): string {
  const build = (diagnosticsLength: number) => {
    const params = new URLSearchParams({ template: "bug_report.yml" });
    if (title) params.set("title", cut(title, 120));
    if (what) params.set("what", cut(what, 2000));
    if (diagnostics) params.set("diagnostics", cut(diagnostics, diagnosticsLength));
    if (system) params.set("system", system);
    return `${NEW_ISSUE}?${params}`;
  };
  // The diagnostics give way first, as little as needed.
  let length = 4000;
  let url = build(length);
  while (url.length > MAX_URL && length > 200) {
    length = Math.floor(length * 0.8);
    url = build(length);
  }
  return url;
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}\n…` : text;
}
