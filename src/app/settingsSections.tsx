import type { ColumnOptions } from "../components/CommitList";
import { appearanceRows } from "../components/AppearanceRows";
import { ColumnsIcon, ContrastIcon, DiffIcon, DownloadIcon, FetchIcon, GearIcon, HistoryIcon, LockIcon, UserIcon } from "../components/Icons";
import type { SettingRow, SettingsSection } from "../components/SettingsDialog";
import type { GitHubStatus } from "../api";
import type { Theme } from "../lib/appearance";
import type { Updates } from "../lib/updates";
import { FETCH_MINUTES, HISTORY_MINUTES, ZOOM_LEVELS } from "./constants";
import type { NewCommitNotices, Preferences, ReleaseLocks, SubmoduleUpdates } from "./usePreferences";

/** The Settings section with the diff and merge tools, to open it at. */
export const DIFF_SECTION = "Diff and merge";

interface Options {
  preferences: Preferences;
  /** The version running, once known. */
  version: string | null;
  updates: Updates;
  onInstallUpdate: () => void;
  /** Who's signed in to GitHub. */
  github: {
    status: GitHubStatus | null;
    error: string | null;
    onSignIn: () => void;
    onSignOut: () => void;
  };
  /** Which diff and merge tools git opens. */
  diffTools: SettingRow[];
  /** The editor and terminal "Open in …" uses. */
  apps: SettingRow[];
  /** Saving the settings to a file, and reading them back. */
  transfer: SettingRow;
  /** The theme in use (for "Same as the system", the system's). */
  theme: Theme;
}

/** Everything in the Settings window: the app's own settings (each repository has its own window). */
export function settingsSections({ preferences, version, updates, onInstallUpdate, github, diffTools, apps, transfer, theme }: Options): SettingsSection[] {
  const { reopenTabs, setReopenTabs, autoUpdate, setAutoUpdate, autoFetch, setAutoFetch, fetchMinutes, setFetchMinutes } = preferences;
  const { newCommitNotices, setNewCommitNotices, requestNotices, setRequestNotices, largeFileMB, setLargeFileMB, autoLock, setAutoLock, dense, setDense } = preferences;
  const { releaseLocks, setReleaseLocks, submoduleUpdates, setSubmoduleUpdates } = preferences;
  const { daySeparators, setDaySeparators, previews, setPreviews, profilePictures, setProfilePictures } = preferences;
  const { columnOptions, setColumnOptions, zoom, setZoom } = preferences;
  const { historyMinutes, setHistoryMinutes, historyMaxMB, setHistoryMaxMB, historyDays, setHistoryDays } = preferences;
  const sections: SettingsSection[] = [
    {
      title: "General",
      icon: <GearIcon size={15} />,
      rows: [
        { kind: "toggle", label: "Reopen tabs on launch", value: reopenTabs, set: setReopenTabs },
        ...apps,
        {
          kind: "select",
          label: "Submodules after a checkout or pull",
          hint: "When the commit recorded for a submodule changes, git leaves the submodule where it was until it's updated.",
          value: submoduleUpdates,
          options: [
            { value: "ask", label: "Offer to update them" },
            { value: "always", label: "Update them" },
            { value: "never", label: "Leave them as they are" },
          ],
          set: (value) => setSubmoduleUpdates(value as SubmoduleUpdates),
        },
        transfer,
        {
          kind: "toggle",
          label: "Check for updates automatically",
          hint: "New versions come from Tributary's GitHub releases.",
          value: autoUpdate,
          set: setAutoUpdate,
        },
        {
          kind: "custom",
          label: version ? `Version ${version}` : "Version",
          hint: updates.status ?? undefined,
          content: updates.available ? (
            <button className="outline-button" onClick={onInstallUpdate}>
              <DownloadIcon size={14} />
              <span className="button-label">Install {updates.available.version}</span>
            </button>
          ) : (
            <button className="outline-button" onClick={updates.check} disabled={updates.checking}>
              <span className="button-label">{updates.checking ? "Checking…" : "Check now"}</span>
            </button>
          ),
        },
      ],
    },
    {
      title: "Appearance",
      icon: <ContrastIcon size={15} />,
      rows: appearanceRows(preferences.appearance, preferences.setAppearance, theme),
    },
    {
      title: "Accounts",
      icon: <UserIcon size={15} />,
      rows: [
        {
          kind: "custom",
          label: "GitHub",
          hint: github.error
            ? `Couldn't check: ${github.error}`
            : !github.status
              ? "Checking…"
              : github.status.account
                ? `Signed in as ${github.status.account.login}${github.status.account.name ? ` (${github.status.account.name})` : ""}. Pull requests of private repositories show too.`
                : github.status.tokenRejected
                  ? "The token git keeps for GitHub doesn't work any more. Sign in again."
                  : "Sign in to see pull requests of private repositories, and to push without being asked.",
          content: github.status?.account ? (
            <button className="outline-button" onClick={github.onSignOut}>
              <span className="button-label">Sign out</span>
            </button>
          ) : (
            <button className="outline-button" onClick={github.onSignIn} disabled={!github.status && !github.error}>
              <span className="button-label">Sign in…</span>
            </button>
          ),
        },
        {
          kind: "custom",
          label: "GitLab",
          hint: "Merge requests show on their branches. For private projects, Tributary uses the token git keeps for your GitLab server (a personal access token that can read the API).",
          content: null,
        },
      ],
    },
    {
      title: "Fetching",
      icon: <FetchIcon size={15} />,
      rows: [
        {
          kind: "toggle",
          label: "Fetch in the background",
          hint: "Keeps the pull and push counts current.",
          value: autoFetch,
          set: setAutoFetch,
        },
        {
          kind: "select",
          label: "How often",
          value: String(fetchMinutes),
          options: FETCH_MINUTES.map((minutes) => ({ value: String(minutes), label: minutes === 1 ? "Every minute" : `Every ${minutes} minutes` })),
          set: (value) => setFetchMinutes(Number(value)),
          disabled: !autoFetch,
        },
        {
          kind: "select",
          label: "New commits",
          hint: "When a background fetch finds new commits on main, or on the branch yours tracks.",
          value: newCommitNotices,
          options: [
            { value: "off", label: "Don't tell me" },
            { value: "app", label: "Show a message in Tributary" },
            { value: "system", label: "Also notify me when Tributary is in the background" },
          ],
          set: (value) => setNewCommitNotices(value as NewCommitNotices),
          disabled: !autoFetch,
        },
        {
          kind: "select",
          label: "Your pull requests",
          hint: "Reviews and comments on the pull requests you opened (or from your branches), checks that finish or fail, and merges, on GitHub and GitLab.",
          value: requestNotices,
          options: [
            { value: "off", label: "Don't tell me" },
            { value: "app", label: "Show a message in Tributary" },
            { value: "system", label: "Also notify me when Tributary is in the background" },
          ],
          set: (value) => setRequestNotices(value as NewCommitNotices),
        },
      ],
    },
    {
      title: "Local history",
      icon: <HistoryIcon size={15} />,
      rows: [
        {
          kind: "select",
          label: "Keep snapshots of your changes",
          hint: "Every few minutes, the files you've changed but not committed are kept, so a crash or an overwrite doesn't lose your work. Repository → Local History… puts them back.",
          value: String(historyMinutes),
          options: [
            { value: "0", label: "Never" },
            ...HISTORY_MINUTES.map((minutes) => ({ value: String(minutes), label: `Every ${minutes} minutes` })),
          ],
          set: (value) => setHistoryMinutes(Number(value)),
        },
        {
          kind: "select",
          label: "Leave out files bigger than",
          hint: "A copy of every version of big files would fill the disk.",
          value: String(historyMaxMB),
          options: [10, 50, 200, 1000].map((mb) => ({ value: String(mb), label: mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB` })),
          set: (value) => setHistoryMaxMB(Number(value)),
          disabled: historyMinutes <= 0,
        },
        {
          kind: "select",
          label: "Keep them for",
          value: String(historyDays),
          options: [1, 3, 7, 14, 30].map((days) => ({ value: String(days), label: days === 1 ? "A day" : `${days} days` })),
          set: (value) => setHistoryDays(Number(value)),
          disabled: historyMinutes <= 0,
        },
      ],
    },
    {
      title: "Large files and Git LFS",
      icon: <LockIcon size={15} />,
      rows: [
        {
          kind: "select",
          label: "Warn about big files outside Git LFS",
          hint: "Committed into git itself, they stay in every clone forever.",
          value: String(largeFileMB),
          options: [1, 5, 10, 25, 50, 100].map((mb) => ({ value: String(mb), label: `Bigger than ${mb} MB` })),
          set: (value) => setLargeFileMB(Number(value)),
        },
        {
          kind: "toggle",
          label: "Lock files when I change them",
          hint: "Lockable files (like .uasset), as soon as you change one that nobody has locked.",
          value: autoLock,
          set: setAutoLock,
        },
        {
          kind: "select",
          label: "After pushing",
          hint: "Your locks on the files you pushed, so your teammates can work on them. Files you're still changing keep theirs.",
          value: releaseLocks,
          options: [
            { value: "ask", label: "Ask to release my locks" },
            { value: "always", label: "Release my locks" },
            { value: "never", label: "Keep my locks" },
          ],
          set: (value) => setReleaseLocks(value as ReleaseLocks),
        },
      ],
    },
    {
      title: DIFF_SECTION,
      icon: <DiffIcon size={15} />,
      rows: diffTools,
    },
    {
      title: "Commit list",
      icon: <ColumnsIcon size={15} />,
      rows: [
        { kind: "toggle", label: "Compact rows", value: dense, set: setDense },
        { kind: "toggle", label: "Day separators", value: daySeparators, set: setDaySeparators },
        { kind: "toggle", label: "Previews on hover", hint: "A commit's details when you rest the pointer on it.", value: previews, set: setPreviews },
        {
          kind: "toggle",
          label: "Profile pictures",
          hint: "Looked up by email address: on GitHub or GitLab for repositories there, otherwise on Gravatar (which gets a hash of the address).",
          value: profilePictures,
          set: setProfilePictures,
        },
        {
          kind: "custom",
          label: "Columns",
          content: (
            <span className="settings-checks">
              {(["author", "date", "sha"] as const).map((column) => (
                <label key={column} className="checkbox">
                  <input
                    type="checkbox"
                    checked={columnOptions[column]}
                    onChange={() => setColumnOptions({ ...columnOptions, [column]: !columnOptions[column] })}
                  />
                  {column === "sha" ? "SHA" : column[0].toUpperCase() + column.slice(1)}
                </label>
              ))}
            </span>
          ),
        },
        {
          kind: "select",
          label: "Dates",
          value: columnOptions.dateFormat,
          options: [
            { value: "relative", label: "Relative (“3 hours ago”)" },
            { value: "exact", label: "Exact dates and times" },
          ],
          set: (value) => setColumnOptions({ ...columnOptions, dateFormat: value as ColumnOptions["dateFormat"] }),
          disabled: !columnOptions.date,
        },
        {
          kind: "select",
          label: "Which date",
          value: columnOptions.dateKind,
          options: [
            { value: "authored", label: "When it was written" },
            { value: "committed", label: "When it was committed" },
          ],
          set: (value) => setColumnOptions({ ...columnOptions, dateKind: value as ColumnOptions["dateKind"] }),
          disabled: !columnOptions.date,
        },
        {
          kind: "select",
          label: "Zoom",
          value: String(zoom),
          options: ZOOM_LEVELS.map((level) => ({ value: String(level), label: `${Math.round(level * 100)}%` })),
          set: (value) => setZoom(Number(value)),
        },
      ],
    },
  ];
  return sections;
}
