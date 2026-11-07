import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/** Show a system notification (asking for permission the first time, where needed). */
export async function notifySystem(title: string, body: string): Promise<void> {
  try {
    let allowed = await isPermissionGranted();
    if (!allowed) allowed = (await requestPermission()) === "granted";
    if (allowed) sendNotification({ title, body });
  } catch {
    // Notifications aren't available: the message is shown in the window anyway.
  }
}
