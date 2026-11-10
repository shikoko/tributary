import type { Tab } from "../components/TabBar";
import { DEFAULT_COLUMNS, type ColumnOptions, type ColumnWidths } from "../components/CommitList";
import type { Appearance } from "../lib/appearance";
import type { ScheduleDays, ScheduledRun } from "../lib/schedule";
import type { TourId } from "../lib/tours";
import { useStoredState } from "../lib/settings";
import { APPEARANCE_KEY } from "./useAppearance";

/** How new commits found by a background fetch are announced. */
export type NewCommitNotices = "off" | "app" | "system";

/** Everything remembered between launches: layout, view options and settings. */
export function usePreferences() {
  const [tabs, setTabs] = useStoredState<Tab[]>("tabs.list", []);
  const [, setActiveTab] = useStoredState<string | null>("tabs.active", null);
  const [sidebarOpen, setSidebarOpen] = useStoredState("sidebar.open", true);
  const [sidebarWidth, setSidebarWidth] = useStoredState("sidebar.width", 220);
  const [detailsWidth, setDetailsWidth] = useStoredState("details.width", 380);
  const [columnWidths, setColumnWidths] = useStoredState<ColumnWidths>("columns", { refs: null, graph: null });
  const [columnOptions, setColumnOptions] = useStoredState<ColumnOptions>("columns.shown", DEFAULT_COLUMNS);
  const [daySeparators, setDaySeparators] = useStoredState("list.daySeparators", true);
  const [dense, setDense] = useStoredState("rows.compact", false);
  const [zoom, setZoom] = useStoredState("zoom", 1);
  const [autoFetch, setAutoFetch] = useStoredState("fetch.auto", true);
  const [reopenTabs, setReopenTabs] = useStoredState("reopenLast", true);
  const [firstParentOnly, setFirstParentOnly] = useStoredState("history.firstParent", false);
  const [profilePictures, setProfilePictures] = useStoredState("avatars.pictures", false);
  const [previews, setPreviews] = useStoredState("previews", true);
  const [activityOpen, setActivityOpen] = useStoredState("activity.open", false);
  const [fetchMinutes, setFetchMinutes] = useStoredState("fetch.minutes", 5);
  /** New commits found by a background fetch: not mentioned, a message in the window, or a system notification too. */
  const [newCommitNotices, setNewCommitNotices] = useStoredState<NewCommitNotices>("notify.newCommits", "app");
  /** News of your pull requests (reviews, comments, checks, merges): the same choices. */
  const [requestNotices, setRequestNotices] = useStoredState<NewCommitNotices>("notify.pullRequests", "app");
  const [autoUpdate, setAutoUpdate] = useStoredState("updates.auto", true);
  /** Warn about files at least this big (in MB) that aren't in Git LFS. */
  const [largeFileMB, setLargeFileMB] = useStoredState("files.largeMB", 10);
  /** Lock lockable files as soon as you change them. */
  const [autoLock, setAutoLock] = useStoredState("locks.auto", false);
  /** After pushing: ask to release the locks on the pushed files, release them, or keep them. */
  const [releaseLocks, setReleaseLocks] = useStoredState<ReleaseLocks>("locks.release", "ask");
  const [submoduleUpdates, setSubmoduleUpdates] = useStoredState<SubmoduleUpdates>("submodules.update", "ask");
  /** Guided tours: never offered (Help → Tours still has them), offered or taken already, finished, and Getting started waiting for someone new's first repository. */
  const [toursOff, setToursOff] = useStoredState("tours.off", false);
  const [toursSeen, setToursSeen] = useStoredState<TourId[]>("tours.seen", []);
  const [toursDone, setToursDone] = useStoredState<TourId[]>("tours.done", []);
  const [toursFirst, setToursFirst] = useStoredState("tours.first", false);
  /** Simple mode: Get latest, your changes and Submit, and the team, without the graph. */
  const [simpleMode, setSimpleMode] = useStoredState("view.simple", false);
  /** Local history: a snapshot of uncommitted work this often (minutes, 0 for never), of files up to so big (MB), kept so many days. */
  const [historyMinutes, setHistoryMinutes] = useStoredState("history.minutes", 10);
  const [historyMaxMB, setHistoryMaxMB] = useStoredState("history.maxMB", 50);
  const [historyDays, setHistoryDays] = useStoredState("history.days", 7);
  /** Get latest on a schedule: on which days, at what time, the last run started (its key) and how the last one went. */
  const [scheduleDays, setScheduleDays] = useStoredState<ScheduleDays>("schedule.days", "off");
  const [scheduleTime, setScheduleTime] = useStoredState("schedule.time", "07:00");
  const [scheduleLast, setScheduleLast] = useStoredState<string | null>("schedule.last", null);
  const [scheduleRun, setScheduleRun] = useStoredState<ScheduledRun | null>("schedule.run", null);
  /** Light or dark, the accent colour, the graph's and the diffs' colours (filled in by normalizeAppearance). */
  const [appearance, setAppearance] = useStoredState<Partial<Appearance>>(APPEARANCE_KEY, {});
  return {
    tabs, setTabs, setActiveTab,
    sidebarOpen, setSidebarOpen, sidebarWidth, setSidebarWidth, detailsWidth, setDetailsWidth,
    columnWidths, setColumnWidths, columnOptions, setColumnOptions, daySeparators, setDaySeparators,
    dense, setDense, zoom, setZoom, autoFetch, setAutoFetch, reopenTabs, setReopenTabs,
    firstParentOnly, setFirstParentOnly, profilePictures, setProfilePictures, previews, setPreviews,
    activityOpen, setActivityOpen, fetchMinutes, setFetchMinutes, newCommitNotices, setNewCommitNotices, requestNotices, setRequestNotices,
    autoUpdate, setAutoUpdate, largeFileMB, setLargeFileMB, autoLock, setAutoLock, releaseLocks, setReleaseLocks,
    submoduleUpdates, setSubmoduleUpdates, appearance, setAppearance,
    simpleMode, setSimpleMode,
    toursOff, setToursOff, toursSeen, setToursSeen, toursDone, setToursDone, toursFirst, setToursFirst,
    historyMinutes, setHistoryMinutes, historyMaxMB, setHistoryMaxMB, historyDays, setHistoryDays,
    scheduleDays, setScheduleDays, scheduleTime, setScheduleTime, scheduleLast, setScheduleLast, scheduleRun, setScheduleRun,
  };
}

export type Preferences = ReturnType<typeof usePreferences>;

/** What to do with your locks on files you've just pushed. */
export type ReleaseLocks = "ask" | "always" | "never";
/** After a checkout or pull leaves submodules behind: offer to update them, update them, or say nothing. */
export type SubmoduleUpdates = "ask" | "always" | "never";
