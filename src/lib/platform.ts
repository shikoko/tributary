export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** The label of the main shortcut modifier key on this platform. */
export const modKey = isMac ? "⌘" : "Ctrl+";
