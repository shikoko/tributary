import type { Tab } from "../components/TabBar";
import { DEFAULT_COLUMNS, type ColumnOptions, type ColumnWidths } from "../components/CommitList";
import { useStoredState } from "../lib/settings";

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
  const [autoUpdate, setAutoUpdate] = useStoredState("updates.auto", true);
  /** Warn about files at least this big (in MB) that aren't in Git LFS. */
  const [largeFileMB, setLargeFileMB] = useStoredState("files.largeMB", 10);
  /** Lock lockable files as soon as you change them. */
  const [autoLock, setAutoLock] = useStoredState("locks.auto", false);
  /** After pushing: ask to release the locks on the pushed files, release them, or keep them. */
  const [releaseLocks, setReleaseLocks] = useStoredState<ReleaseLocks>("locks.release", "ask");
  return {
    tabs, setTabs, setActiveTab,
    sidebarOpen, setSidebarOpen, sidebarWidth, setSidebarWidth, detailsWidth, setDetailsWidth,
    columnWidths, setColumnWidths, columnOptions, setColumnOptions, daySeparators, setDaySeparators,
    dense, setDense, zoom, setZoom, autoFetch, setAutoFetch, reopenTabs, setReopenTabs,
    firstParentOnly, setFirstParentOnly, profilePictures, setProfilePictures, previews, setPreviews,
    activityOpen, setActivityOpen, fetchMinutes, setFetchMinutes, newCommitNotices, setNewCommitNotices,
    autoUpdate, setAutoUpdate, largeFileMB, setLargeFileMB, autoLock, setAutoLock, releaseLocks, setReleaseLocks,
  };
}

export type Preferences = ReturnType<typeof usePreferences>;

/** What to do with your locks on files you've just pushed. */
export type ReleaseLocks = "ask" | "always" | "never";
