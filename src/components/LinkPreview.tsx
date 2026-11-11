import { useLinkUrl } from "../lib/linkPreview";

/**
 * Where there's no status bar to say it in (the start screen), the address a link opens, at
 * the bottom left of the window while it's pointed at, as browsers show it.
 */
export function LinkPreview() {
  const url = useLinkUrl();
  if (!url) return null;
  return (
    <div className="link-preview" aria-hidden>
      {url}
    </div>
  );
}
