import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CloseGlyph, MaximizeGlyph, MinimizeGlyph, RestoreGlyph } from "./Icons";

/**
 * Minimize, maximize and close, for Windows, where the tab bar is the title bar
 * (the window has no frame of its own there).
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const window = getCurrentWindow();
    let stop: (() => void) | undefined;
    let disposed = false;
    const update = () =>
      window
        .isMaximized()
        .then((value) => !disposed && setMaximized(value))
        .catch(() => {});
    update();
    window
      .onResized(update)
      .then((unlisten) => (disposed ? unlisten() : (stop = unlisten)))
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  const window = () => getCurrentWindow();
  return (
    <div className="window-controls">
      <button className="window-control" onClick={() => window().minimize().catch(() => {})} title="Minimize" aria-label="Minimize">
        <MinimizeGlyph />
      </button>
      <button
        className="window-control"
        onClick={() => window().toggleMaximize().catch(() => {})}
        title={maximized ? "Restore Down" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button className="window-control close" onClick={() => window().close().catch(() => {})} title="Close" aria-label="Close">
        <CloseGlyph />
      </button>
    </div>
  );
}
