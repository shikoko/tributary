import { useContext, useEffect, useState } from "react";
import { WelcomeTour, WhatsNewDialog } from "../components/WhatsNew";
import { forMenu, onStart, type Release } from "../lib/whatsNew";
import { loadRecent } from "../lib/recent";
import { useStoredState } from "../lib/settings";
import { getVersion } from "@tauri-apps/api/app";
import { signOutOfGitHub } from "../api";
import type { Updates } from "../lib/updates";
import { CloneDialog } from "../components/CloneDialog";
import { CommandPalette, type Command } from "../components/CommandPalette";
import { ContextMenu } from "../components/ContextMenu";
import { DiagnosticsDialog } from "../components/DiagnosticsDialog";
import { GitHubSignInDialog } from "../components/GitHubSignInDialog";
import { FolderIcon } from "../components/Icons";
import { SettingsDialog } from "../components/SettingsDialog";
import { ShortcutsDialog } from "../components/ShortcutsDialog";
import { Toast, type ToastMessage } from "../components/Toast";
import { UpdateDialog } from "../components/UpdateDialog";
import { useAppRows } from "../components/AppRows";
import { settingsTransferRow } from "../components/SettingsTransferRow";
import { useDiffToolRows } from "../components/DiffToolRows";
import { settingsSections } from "./settingsSections";
import { useGitHubStatus } from "./useGitHub";
import type { ContextMenuState } from "./useMenus";
import type { Overlays } from "./useOverlays";
import type { Preferences } from "./usePreferences";
import { ThemeContext } from "./useAppearance";

interface Props {
  overlays: Overlays;
  /** Get the latest of every open repository now, as the schedule does. */
  onGetLatestNow: () => Promise<void>;
  menu: ContextMenuState;
  /** What the command palette offers, worked out when it opens. */
  commands: () => Command[];
  preferences: Preferences;
  updates: Updates;
  repoPath: string | null;
  /** The Settings section to open at, if not the first. */
  settingsSection?: string;
  /** The clone dialog is open. */
  cloning: boolean;
  onCloneCancel: () => void;
  onCloned: (path: string) => void;
  /** Signed in to GitHub (pull requests can be asked for again). */
  onSignedIn: () => void;
  toast: ToastMessage | null;
  notify: (toast: ToastMessage) => void;
  hideToast: () => void;
  /** A folder is being dragged over the window. */
  dropping: boolean;
}

/** Everything that opens over the app, whether a repository is open or not. */
export function AppOverlays(props: Props) {
  const { overlays, menu, preferences, updates, notify } = props;
  const { theme } = useContext(ThemeContext);
  const { open, hide, show } = overlays;
  const github = useGitHubStatus(open.settings);
  const appRows = useAppRows();
  const diffTools = useDiffToolRows({ open: open.settings, repoPath: props.repoPath, notify: (text) => notify({ text }) });
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);
  // After an update, what's new (once); for someone new, the tour.
  const [seen, setSeen] = useStoredState<string | null>("whatsNew.seen", null);
  const [news, setNews] = useState<Release[]>([]);
  useEffect(() => {
    if (!version || version === seen || !/^\d/.test(version)) return;
    const start = onStart(version, seen, loadRecent().length > 0);
    setSeen(version);
    if (start.show === "tour") show("welcome");
    if (start.show === "news") {
      setNews(start.releases);
      show("whatsNew");
    }
    // Only when the version is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  // From Help: what this version brought (or the newest notes there are).
  const shownNews = news.length > 0 ? news : forMenu(version);

  return (
    <>
      {props.cloning && <CloneDialog onCancel={props.onCloneCancel} onDone={props.onCloned} />}
      {open.palette && <CommandPalette commands={props.commands()} onClose={() => hide("palette")} />}
      {open.shortcuts && <ShortcutsDialog onClose={() => hide("shortcuts")} />}
      {open.whatsNew && shownNews.length > 0 && (
        <WhatsNewDialog
          releases={shownNews}
          onClose={() => {
            hide("whatsNew");
            setNews([]);
          }}
        />
      )}
      {open.welcome && <WelcomeTour onClose={() => hide("welcome")} />}
      {open.settings && (
        <SettingsDialog
          initial={props.settingsSection}
          sections={settingsSections({
            diffTools,
            apps: appRows,
            transfer: settingsTransferRow((text) => notify({ text })),
            theme,
            preferences,
            version,
            updates,
            onInstallUpdate: () => show("update"),
            onGetLatestNow: () => {
              hide("settings");
              void props.onGetLatestNow();
            },
            github: {
              status: github.status,
              error: github.error,
              onSignIn: () => show("signIn"),
              onSignOut: () =>
                signOutOfGitHub()
                  .then(() => notify({ text: "Signed out of GitHub" }))
                  .catch((e) => notify({ text: `Couldn't sign out: ${e}` }))
                  .finally(github.recheck),
            },
          })}
          onClose={() => hide("settings")}
        />
      )}
      {open.signIn && (
        <GitHubSignInDialog
          status={github.status}
          onCancel={() => hide("signIn")}
          onDone={(account) => {
            hide("signIn");
            notify({ text: `Signed in to GitHub as ${account.login}` });
            github.recheck();
            props.onSignedIn();
          }}
        />
      )}
      {open.diagnostics && (
        <DiagnosticsDialog
          repoPath={props.repoPath}
          extra={{ Zoom: `${Math.round(preferences.zoom * 100)}%`, Webview: navigator.userAgent }}
          onCopied={() => {
            hide("diagnostics");
            notify({ text: "Copied the diagnostics" });
          }}
          onClose={() => hide("diagnostics")}
        />
      )}
      {open.update && updates.available && <UpdateDialog update={updates.available} onClose={() => hide("update")} />}
      {menu.menu && (
        <ContextMenu x={menu.menu.x} y={menu.menu.y} items={menu.menu.items} onSideways={menu.menu.onSideways} onClose={menu.close} />
      )}
      {props.dropping && (
        <div className="drop-overlay">
          <FolderIcon size={28} />
          <span>Drop a folder to open it</span>
        </div>
      )}
      {props.toast && <Toast toast={props.toast} onDone={props.hideToast} />}
    </>
  );
}
