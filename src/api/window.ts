// The app's window and icon.
import { invoke } from "./invoke";

/** Show the app icon for a dark (or light) theme: in the Dock on macOS, the taskbar elsewhere. */
export function setAppIcon(dark: boolean): Promise<void> {
  return invoke("set_app_icon", { dark });
}
