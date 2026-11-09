import { useEffect, useState } from "react";
import { trackerSignIn, trackerSignOut, trackerStatus, type Tracker, type TrackerKind, type TrackerStatus } from "../api";
import type { TrackerSetting } from "../lib/issues";
import { useRepoSetting } from "../lib/repoPrefs";
import type { SettingRow } from "./SettingsDialog";

const NAMES: Record<TrackerKind, string> = { github: "GitHub issues", gitlab: "GitLab issues", jira: "Jira", linear: "Linear" };

/**
 * The repository's issue tracker, in its settings: its remote's own issues, Jira or Linear
 * (with the address, project keys and signing in), or none.
 */
export function useIssueRows(path: string, automatic: Tracker | null): SettingRow[] {
  const [setting, setSetting] = useRepoSetting<TrackerSetting>("issueTracker", path, null);
  const chosen: Tracker | null = setting === "off" ? null : (setting ?? automatic);
  const [draft, setDraft] = useState({ site: "", keys: "" });
  const [signIn, setSignIn] = useState({ user: "", token: "" });
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = chosen && (chosen.kind === "jira" || chosen.kind === "linear") ? chosen : null;
  const ownKey = own ? `${own.kind}|${own.site}` : "";
  useEffect(() => {
    setDraft({ site: own?.site ?? "", keys: own?.keys.join(", ") ?? "" });
    setStatus(null);
    setError(null);
    if (!own || !own.site.trim()) return;
    let current = true;
    trackerStatus(path, own)
      .then((found) => current && setStatus(found))
      .catch(() => current && setStatus({ signedIn: false, user: null }));
    return () => {
      current = false;
    };
    // `ownKey` stands for the tracker's kind and address.
  }, [path, ownKey]);

  const choice = setting === "off" ? "off" : setting ? setting.kind : "auto";
  const choose = (value: string) => {
    if (value === "auto") setSetting(null);
    else if (value === "off") setSetting("off");
    else setSetting({ kind: value as TrackerKind, site: "", keys: [] });
  };
  const rows: SettingRow[] = [
    {
      kind: "select",
      label: "Issue tracker",
      hint: "Issue keys in commit messages and branch names (like FEAST-12, or #12) link to their issues, commit details show their titles, and a new branch can start from one of your issues.",
      value: choice,
      options: [
        { value: "auto", label: automatic ? `${NAMES[automatic.kind]} (the remote's own)` : "None (the remote has no issues)" },
        { value: "github", label: "GitHub issues" },
        { value: "gitlab", label: "GitLab issues" },
        { value: "jira", label: "Jira" },
        { value: "linear", label: "Linear" },
        { value: "off", label: "None" },
      ],
      set: choose,
    },
  ];
  if (chosen && !own) {
    rows.push({
      kind: "custom",
      label: chosen.kind === "github" ? "Signed in with your GitHub account" : "Signed in with git's token for GitLab",
      hint: chosen.kind === "github" ? "Settings, Accounts. Without it, issues in private repositories can't be read." : "The token git keeps for your GitLab server, as for merge requests.",
      content: null,
    });
    return rows;
  }
  if (!own) return rows;

  const jira = own.kind === "jira";
  const save = () =>
    setSetting({
      kind: own.kind,
      site: draft.site.trim(),
      keys: draft.keys
        .split(/[\s,]+/)
        .map((key) => key.trim().toUpperCase())
        .filter(Boolean),
    });
  const changed = draft.site.trim() !== own.site || draft.keys.split(/[\s,]+/).filter(Boolean).join(",").toUpperCase() !== own.keys.join(",");
  rows.push(
    {
      kind: "custom",
      label: jira ? "Jira's address" : "Linear workspace",
      hint: jira ? "Like https://studio.atlassian.net, or your own Jira server." : "The name in your Linear addresses: linear.app/studio is studio.",
      content: (
        <input
          className="text-input settings-input"
          value={draft.site}
          onChange={(event) => setDraft({ ...draft, site: event.target.value })}
          placeholder={jira ? "https://studio.atlassian.net" : "studio"}
          spellCheck={false}
          autoCapitalize="off"
          aria-label={jira ? "Jira's address" : "Linear workspace"}
        />
      ),
    },
    {
      kind: "custom",
      label: jira ? "Projects" : "Teams",
      hint: `Their keys, like ${jira ? "FEAST" : "ENG"}: only these count as issues (others look the same, like UTF-8). Empty for any.`,
      content: (
        <input
          className="text-input settings-input"
          value={draft.keys}
          onChange={(event) => setDraft({ ...draft, keys: event.target.value })}
          placeholder={jira ? "FEAST, ART" : "ENG"}
          spellCheck={false}
          aria-label={jira ? "Project keys" : "Team keys"}
        />
      ),
    },
    {
      kind: "custom",
      label: "",
      content: (
        <button className="primary-small-button" onClick={save} disabled={!changed || !draft.site.trim()}>
          Save
        </button>
      ),
    },
  );
  if (!own.site.trim()) return rows;
  if (status?.signedIn) {
    rows.push({
      kind: "custom",
      label: `Signed in to ${NAMES[own.kind]} as ${status.user ?? "you"}`,
      hint: "The key is kept by git's credential helper, not by Tributary.",
      content: (
        <button
          className="outline-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await trackerSignOut(own).catch(() => {});
            setStatus({ signedIn: false, user: null });
            setBusy(false);
          }}
        >
          <span className="button-label">Sign out</span>
        </button>
      ),
    });
    return rows;
  }
  rows.push({
    kind: "custom",
    label: `Sign in to ${NAMES[own.kind]}`,
    hint: jira
      ? "Jira Cloud: your email and an API token (id.atlassian.com, Security, API tokens). Your own Jira server: no email, and a personal access token. It's checked with Jira, then kept by git's credential helper."
      : "A personal API key (Linear's Settings, Security & access). It's checked with Linear, then kept by git's credential helper.",
    content: (
      <form
        className="remote-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            setStatus(await trackerSignIn(own, signIn.user, signIn.token));
            setSignIn({ user: "", token: "" });
          } catch (e) {
            setError(String(e));
          }
          setBusy(false);
        }}
      >
        {jira && (
          <input
            className="text-input settings-input"
            value={signIn.user}
            onChange={(event) => setSignIn({ ...signIn, user: event.target.value })}
            placeholder="you@studio.com"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Jira email"
          />
        )}
        <input
          className="text-input settings-input"
          type="password"
          value={signIn.token}
          onChange={(event) => setSignIn({ ...signIn, token: event.target.value })}
          placeholder={jira ? "API token" : "lin_api_…"}
          aria-label={jira ? "Jira API token" : "Linear API key"}
        />
        {error && <p className="review-error">{error}</p>}
        <div className="remote-form-buttons">
          <button type="submit" className="primary-small-button" disabled={busy || !signIn.token.trim()}>
            {busy ? "Checking…" : "Sign in"}
          </button>
        </div>
      </form>
    ),
  });
  return rows;
}
