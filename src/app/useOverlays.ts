import { useCallback, useState } from "react";

/** Windows over the app that aren't about the repository. */
export type Overlay = "palette" | "shortcuts" | "settings" | "diagnostics" | "signIn" | "gitlabSignIn" | "update" | "whatsNew" | "tours" | "licences";

const NONE: Record<Overlay, boolean> = { palette: false, shortcuts: false, settings: false, diagnostics: false, signIn: false, gitlabSignIn: false, update: false, whatsNew: false, tours: false, licences: false };

/** Which overlays are open. Several can be (signing in, over Settings). */
export function useOverlays() {
  const [open, setOpen] = useState(NONE);
  const show = useCallback((overlay: Overlay) => setOpen((current) => ({ ...current, [overlay]: true })), []);
  const hide = useCallback((overlay: Overlay) => setOpen((current) => ({ ...current, [overlay]: false })), []);
  const toggle = useCallback((overlay: Overlay) => setOpen((current) => ({ ...current, [overlay]: !current[overlay] })), []);
  return { open, show, hide, toggle };
}

export type Overlays = ReturnType<typeof useOverlays>;
