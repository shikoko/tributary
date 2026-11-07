export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** The label of the main shortcut modifier key on this platform. */
export const modKey = isMac ? "⌘" : "Ctrl+";

/** On Windows, Tributary draws its own title bar buttons in the tab bar. */
export const isWindows = /Windows/.test(navigator.userAgent);
