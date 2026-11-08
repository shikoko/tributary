// The app's window and icon.
import { invoke } from "@tauri-apps/api/core";

/** Show the app icon for a dark (or light) theme: in the Dock on macOS, the taskbar elsewhere. */
export function setAppIcon(dark: boolean): Promise<void> {
  return invoke<void>("set_app_icon", { dark });
}
