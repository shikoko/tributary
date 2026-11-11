import { useEffect, useRef } from "react";
import { DownloadIcon } from "../components/Icons";
import type { ToastMessage } from "../components/Toast";
import type { Updates } from "../lib/updates";

/**
 * Says when a new version is ready to install (it's downloaded as soon as it's found, a few
 * seconds after opening), with a button to restart into it: or, if it couldn't be
 * downloaded, that it's out. Once for each version.
 */
export function useUpdateNotice(updates: Updates, notify: (toast: ToastMessage) => void, showUpdate: () => void) {
  const told = useRef(new Set<string>());
  const version = updates.available?.version ?? null;
  const { ready, restart } = updates;
  const failed = updates.error?.step === "download";
  useEffect(() => {
    if (!version) return;
    const say = (key: string, toast: ToastMessage) => {
      if (told.current.has(key)) return;
      told.current.add(key);
      notify({ icon: <DownloadIcon size={14} />, ...toast });
    };
    if (ready) {
      say(`${version}:ready`, {
        text: `Tributary ${version} is ready: it installs when you restart or quit`,
        action: { label: "Restart", onClick: () => void restart() },
      });
    } else if (failed) {
      say(`${version}:out`, { text: `Tributary ${version} is out`, action: { label: "Update", onClick: showUpdate } });
    }
  }, [version, ready, failed, restart, notify, showUpdate]);
}
