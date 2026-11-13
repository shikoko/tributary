export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** The label of the main shortcut modifier key on this platform. */
export const modKey = isMac ? "⌘" : "Ctrl+";

/** On Windows, Tributary draws its own title bar buttons in the tab bar. */
export const isWindows = /Windows/.test(navigator.userAgent);

/**
 * Keeps `--device-pixel` on the page at one screen pixel, in CSS pixels (1px at 100%, ⅔px at
 * 150%), for nudges that must be a part of a screen pixel whatever the display's scale: it
 * follows the window to a screen with another scale, and zooming in and out.
 */
export function watchDevicePixel() {
  let ratio = 0;
  const update = () => {
    if ((window.devicePixelRatio || 1) === ratio) return;
    ratio = window.devicePixelRatio || 1;
    document.documentElement.style.setProperty("--device-pixel", `${1 / ratio}px`);
    // A new scale is announced by the media query for this one no longer matching.
    window.matchMedia(`(resolution: ${ratio}dppx)`).addEventListener("change", update, { once: true });
  };
  update();
  // Zooming resizes the page as well (and so does moving to another screen, on most systems).
  window.addEventListener("resize", update);
}
