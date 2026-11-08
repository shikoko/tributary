import { useEffect, useState } from "react";
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
import { settingsSections } from "./settingsSections";
import { useGitHubStatus } from "./useGitHub";
import type { ContextMenuState } from "./useMenus";
import type { Overlays } from "./useOverlays";
import type { Preferences } from "./usePreferences";

interface Props {
  overlays: Overlays;
  menu: ContextMenuState;
  /** What the command palette offers, worked out when it opens. */
  commands: () => Command[];
  preferences: Preferences;
  updates: Updates;
  /** The open repository's own settings, for the Settings window. */
  repository: Parameters<typeof settingsSections>[0]["repository"];
  repoPath: string | null;
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
  const { open, hide, show } = overlays;
  const github = useGitHubStatus(open.settings);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  return (
    <>
      {props.cloning && <CloneDialog onCancel={props.onCloneCancel} onDone={props.onCloned} />}
      {open.palette && <CommandPalette commands={props.commands()} onClose={() => hide("palette")} />}
      {open.shortcuts && <ShortcutsDialog onClose={() => hide("shortcuts")} />}
      {open.settings && (
        <SettingsDialog
          sections={settingsSections({
            preferences,
            version,
            updates,
            onInstallUpdate: () => show("update"),
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
            repository: props.repository,
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
