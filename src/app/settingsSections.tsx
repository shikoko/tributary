import type { ColumnOptions } from "../components/CommitList";
import { appearanceRows } from "../components/AppearanceRows";
import { BranchIcon, ClockIcon, ColumnsIcon, ContrastIcon, DiffIcon, FetchIcon, GearIcon, HistoryIcon, LockIcon, TransferIcon, UserIcon } from "../components/Icons";
import { describeRun, nextRun, type ScheduleDays } from "../lib/schedule";
import type { SettingRow, SettingsSection } from "../components/SettingsDialog";
import type { GitHubStatus, GitLabStatus } from "../api";
import { GITLAB_COM, type Forge } from "./useAccounts";
import type { Theme } from "../lib/appearance";
import { FETCH_MINUTES, HISTORY_MINUTES, SCHEDULE_TIMES, ZOOM_LEVELS } from "./constants";
import type { NewCommitNotices, Preferences, ReleaseLocks, SubmoduleUpdates } from "./usePreferences";
import { Button } from "../components/ui/Button";

/** The Settings section with the diff and merge tools, to open it at. */
export const DIFF_SECTION = "Diff and merge";

interface Options {
  preferences: Preferences;
  /** Fetch the latest of every open repository now, as the schedule does. */
  onFetchLatestNow: () => void;
  /** Who's signed in to GitHub and GitLab. */
  accounts: {
    github: GitHubStatus | null;
    githubError: string | null;
    gitlab: GitLabStatus | null;
    gitlabError: string | null;
    onSignIn: (forge: Forge) => void;
    onSignOut: (forge: Forge) => void;
  };
  /** Which diff and merge tools git opens. */
  diffTools: SettingRow[];
  /** The editor and terminal "Open in …" uses. */
  apps: SettingRow[];
  /** Exporting the settings, and importing them back. */
  transfer: SettingRow[];
  /** The theme in use (for "Same as the system", the system's). */
  theme: Theme;
}

/** Everything in the Settings window: the app's own settings (each repository has its own window). */
export function settingsSections({ preferences, onFetchLatestNow, accounts, diffTools, apps, transfer, theme }: Options): SettingsSection[] {
  const { reopenTabs, setReopenTabs, autoFetch, setAutoFetch, fetchMinutes, setFetchMinutes } = preferences;
  const { newCommitNotices, setNewCommitNotices, requestNotices, setRequestNotices, largeFileMB, setLargeFileMB, autoLock, setAutoLock, dense, setDense } = preferences;
  const { releaseLocks, setReleaseLocks, submoduleUpdates, setSubmoduleUpdates } = preferences;
  const { daySeparators, setDaySeparators, previews, setPreviews, profilePictures, setProfilePictures } = preferences;
  const { columnOptions, setColumnOptions, zoom, setZoom } = preferences;
  const { historyMinutes, setHistoryMinutes, historyMaxMB, setHistoryMaxMB, historyDays, setHistoryDays } = preferences;
  const { scheduleDays, setScheduleDays, scheduleTime, setScheduleTime, scheduleRun } = preferences;
  const next = nextRun(scheduleDays, scheduleTime, new Date());
  const looks = appearanceRows(preferences.appearance, preferences.setAppearance, theme);
  const zoomRow: SettingRow = {
    kind: "select",
    label: "Zoom",
    value: String(zoom),
    options: ZOOM_LEVELS.map((level) => ({ value: String(level), label: `${Math.round(level * 100)}%` })),
    set: (value) => setZoom(Number(value)),
  };
  const sections: SettingsSection[] = [
    {
      title: "General",
      icon: <GearIcon size={15} />,
      rows: [
        {
          kind: "toggle",
          label: "Simple mode",
          hint: "Get latest, your changes with their locks and Submit (commit and push in one), and what the team's working on, without branches and the commit graph. View → Simple Mode, or Full view, switches back.",
          value: preferences.simpleMode,
          set: preferences.setSimpleMode,
        },
        {
          kind: "toggle",
          label: "Offer tours",
          hint: "A short guided tour when you first come across something, like locks or Simple mode. Help → Tours has them all, any time.",
          value: !preferences.toursOff,
          set: (offered) => preferences.setToursOff(!offered),
        },
        {
          kind: "toggle",
          label: "Introduce Why Is a File Ignored…",
          hint: "What it does, before you choose a file (Repository → Tools).",
          value: !preferences.skipIgnoreIntro,
          set: (shown) => preferences.setSkipIgnoreIntro(!shown),
        },
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
      ],
    },
    {
      title: "Appearance",
      icon: <ContrastIcon size={15} />,
      rows: [...looks.look, zoomRow, looks.reset],
    },
    {
      title: "Graph",
      icon: <BranchIcon size={15} />,
      parent: "Appearance",
      rows: looks.graph,
    },
    {
      title: "Commit list",
      icon: <ColumnsIcon size={15} />,
      parent: "Appearance",
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
          kind: "toggle",
          label: "Checks on commits",
          hint: "A dot on each commit for its CI on GitHub or GitLab: green when the checks passed, red when they failed, amber while they run.",
          value: columnOptions.checks !== false,
          set: (on) => setColumnOptions({ ...columnOptions, checks: on }),
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
      ],
    },
    {
      title: "Accounts",
      icon: <UserIcon size={15} />,
      rows: [
        accountRow({
          forge: "github",
          name: "GitHub",
          error: accounts.githubError,
          known: accounts.github !== null,
          who: accounts.github?.account ? `${accounts.github.account.login}${accounts.github.account.name ? ` (${accounts.github.account.name})` : ""}` : null,
          rejected: Boolean(accounts.github?.tokenRejected),
          signedIn: "Pull requests of private repositories show too, and Clone lists your repositories.",
          signedOut: "Sign in to see pull requests of private repositories, pick from your repositories when cloning, and push without being asked.",
          onSignIn: accounts.onSignIn,
          onSignOut: accounts.onSignOut,
        }),
        accountRow({
          forge: "gitlab",
          name: accounts.gitlab && accounts.gitlab.host !== GITLAB_COM ? `GitLab (${accounts.gitlab.host})` : "GitLab",
          error: accounts.gitlabError,
          known: accounts.gitlab !== null,
          who: accounts.gitlab?.account ? `${accounts.gitlab.account.username}${accounts.gitlab.account.name ? ` (${accounts.gitlab.account.name})` : ""}` : null,
          rejected: Boolean(accounts.gitlab?.tokenRejected),
          signedIn: "Merge requests of private projects show too, and Clone lists your projects.",
          signedOut: "Sign in to gitlab.com or your company's GitLab to see merge requests of private projects, pick from your projects when cloning, and push without being asked.",
          onSignIn: accounts.onSignIn,
          onSignOut: accounts.onSignOut,
        }),
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
      title: "Fetch latest",
      icon: <ClockIcon size={15} />,
      parent: "Fetching",
      rows: [
        {
          kind: "select",
          label: "Fetch the latest of every open repository",
          hint: "Fetches each open tab's repository and moves your branch forward when it can without merging (never past commits of your own, or changes it would overwrite), with its Git LFS files, so a big update is waiting when you start. Tributary has to be running and the computer awake; one that was asleep catches up within an hour of the time, or waits for the next day.",
          value: scheduleDays,
          options: [
            { value: "off", label: "Only when I fetch" },
            { value: "weekdays", label: "On weekdays" },
            { value: "daily", label: "Every day" },
          ],
          set: (value) => setScheduleDays(value as ScheduleDays),
        },
        {
          kind: "select",
          label: "At",
          hint: next ? `Next: ${next.toLocaleString(undefined, { weekday: "long", hour: "2-digit", minute: "2-digit" })}` : undefined,
          value: scheduleTime,
          options: (SCHEDULE_TIMES.includes(scheduleTime) ? SCHEDULE_TIMES : [scheduleTime, ...SCHEDULE_TIMES]).map((time) => ({ value: time, label: time })),
          set: setScheduleTime,
          disabled: scheduleDays === "off",
        },
        {
          kind: "custom",
          label: "Last time",
          hint: scheduleRun
            ? `${new Date(scheduleRun.time).toLocaleString(undefined, { weekday: "long", hour: "2-digit", minute: "2-digit" })}: ${describeRun(scheduleRun)}.${scheduleRun.results
                .filter((result) => !result.ok)
                .map((result) => ` ${result.name}: ${result.message}`)
                .join("")}`
            : "Not yet.",
          content: (
            <Button kind="outline" onClick={onFetchLatestNow}>
              <FetchIcon size={14} />
              <span className="button-label">Fetch latest now</span>
            </Button>
          ),
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
      title: "Export and import",
      icon: <TransferIcon size={15} />,
      separated: true,
      rows: transfer,
    },
  ];
  return sections;
}

/** An account's row: who's signed in (or why not), and a button to sign in or out. */
function accountRow({
  forge,
  name,
  error,
  known,
  who,
  rejected,
  signedIn,
  signedOut,
  onSignIn,
  onSignOut,
}: {
  forge: Forge;
  name: string;
  error: string | null;
  known: boolean;
  who: string | null;
  rejected: boolean;
  signedIn: string;
  signedOut: string;
  onSignIn: (forge: Forge) => void;
  onSignOut: (forge: Forge) => void;
}): SettingRow {
  return {
    kind: "custom",
    label: name,
    hint: error
      ? `Couldn't check: ${error}`
      : !known
        ? "Checking…"
        : who
          ? `Signed in as ${who}. ${signedIn} Signing out makes git forget the token too.`
          : rejected
            ? `The token git keeps for ${name} doesn't work any more. Sign in again.`
            : signedOut,
    content: who ? (
      <span className="settings-buttons">
        <Button kind="outline" onClick={() => onSignIn(forge)}>
          <span className="button-label">Switch account…</span>
        </Button>
        <Button kind="outline" onClick={() => onSignOut(forge)}>
          <span className="button-label">Sign out</span>
        </Button>
      </span>
    ) : (
      <Button kind="outline" onClick={() => onSignIn(forge)} disabled={!known && !error}>
        <span className="button-label">{rejected ? "Sign in again…" : "Sign in…"}</span>
      </Button>
    ),
  };
}
