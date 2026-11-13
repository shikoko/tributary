import { useEffect, useRef, useState, type CSSProperties } from "react";
import { featured, type NoteItem, type NoteSection, type Release } from "../lib/whatsNew";
import { withAlpha } from "../lib/colors";
import { openInBrowser } from "../lib/weblinks";
import { useThemeColors } from "../app/useAppearance";
import { Dialog } from "./Dialog";
import { CheckIcon } from "./Icons";
import { MarkdownLine } from "./Markdown";
import { Button } from "./ui/Button";

/** Each item in its own graph colour, as chosen in Settings (with the next one's, for the lanes beside it). */
function useItemColors() {
  const { lanes } = useThemeColors();
  return (index: number): CSSProperties => {
    const color = lanes[index % lanes.length];
    return {
      "--wn-color": color,
      "--wn-soft": withAlpha(color, 0.16),
      "--wn-faint": withAlpha(color, 0.08),
      "--wn-glow": withAlpha(color, 0.45),
      "--wn-next": lanes[(index + 1) % lanes.length],
    } as CSSProperties;
  };
}

/** An item as one line: its name in bold, then what it says (a name that runs on into its sentence is already in it). */
const line = (item: NoteItem) => (!item.title || item.text.startsWith("**") ? item.text : `**${item.title}:** ${item.text}`);

/** What an item says, under its name: a sentence of its own (in the notes, it carries on from the name). */
const body = (item: NoteItem) => (item.text.startsWith("**") ? item.text : item.text.charAt(0).toUpperCase() + item.text.slice(1));

const Line = ({ text }: { text: string }) => <MarkdownLine text={text} openUrl={openInBrowser} />;

/** A new thing, or the rest of a version (its fixes, and what got better), together. */
type Slide = { kind: "item"; item: NoteItem; version: string } | { kind: "rest"; sections: NoteSection[]; version: string };

/**
 * What changed, after an update (or from What's New in About Tributary): each new thing in
 * turn, large, with a picture of it working and the list of them beside it; then the fixes
 * together. The words and pictures are each version's release notes.
 */
export function WhatsNewDialog({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  const colors = useItemColors();
  const slides: Slide[] = releases.flatMap((release) => {
    const { items, rest } = featured(release);
    const news: Slide[] = items.map((item) => ({ kind: "item", item, version: release.version }));
    return rest.length > 0 ? [...news, { kind: "rest", sections: rest, version: release.version }] : news;
  });
  const [at, setAt] = useState(0);
  // A long list scrolls: it follows the page you're on. (In braces: scrollIntoView returns a
  // promise now, which React would take for the effect's clean-up and call.)
  const nav = useRef<HTMLDivElement>(null);
  useEffect(() => {
    nav.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }, [at]);
  const slide = slides[at];
  const last = at === slides.length - 1;
  // The arrow keys step through them, wherever the focus is in the dialog.
  const count = slides.length;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowRight") setAt((now) => Math.min(count - 1, now + 1));
      else if (event.key === "ArrowUp" || event.key === "ArrowLeft") setAt((now) => Math.max(0, now - 1));
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);
  if (!slide) return null;
  const title = releases.length === 1 ? `What's new in Tributary ${releases[0].version}` : "What's new in Tributary";
  // The rest by their sections' names: "Fixes", "Better and Fixes" (in 0.4.0, when there are several versions).
  const name = (entry: Slide) =>
    entry.kind === "item" ? entry.item.title : `${entry.sections.map((section) => section.name).join(" and ")}${releases.length > 1 ? ` in ${entry.version}` : ""}`;
  return (
    <Dialog
      title={title}
      wide
      onCancel={onClose}
      closable
      className="whats-new-dialog"
      buttons={
        <>
          <span className="wn-step">
            {at + 1} of {slides.length}
          </span>
          <span className="spacer" />
          {at > 0 && (
            <Button kind="secondary" onClick={() => setAt(at - 1)}>
              Back
            </Button>
          )}
          <Button kind="primary" onClick={() => (last ? onClose() : setAt(at + 1))} autoFocus>
            {last ? "Got it" : "Next"}
          </Button>
        </>
      }
    >
      <div className="wn-spotlight">
        <div ref={nav} className="wn-nav" role="tablist" aria-orientation="vertical">
          {slides.map((entry, index) => (
            <button
              key={`${entry.version}-${name(entry)}`}
              role="tab"
              aria-selected={index === at}
              className={index === at ? "on" : undefined}
              style={colors(index)}
              onClick={() => setAt(index)}
            >
              <span className={`wn-nav-dot${entry.kind === "rest" ? " rest" : ""}`}>{entry.kind === "rest" && <CheckIcon size={11} />}</span>
              {name(entry)}
            </button>
          ))}
        </div>
        <div className="wn-stage" key={at} style={colors(at)} role="tabpanel">
          {slide.kind === "item" ? (
            <>
              {slide.item.picture?.src ? (
                <img className="wn-picture" src={slide.item.picture.src} alt={slide.item.picture.alt} />
              ) : (
                <LaneArt index={at} />
              )}
              <span className="wn-stage-version">New in {slide.version}</span>
              <h3>{slide.item.title}</h3>
              <p>
                <Line text={body(slide.item)} />
              </p>
            </>
          ) : (
            <>
              <span className="wn-stage-version">Also in {slide.version}</span>
              <div className="wn-stage-rest">
                {slide.sections.map((section) => (
                  <div key={section.name}>
                    {slide.sections.length > 1 && <h4 className="wn-section-name">{section.name}</h4>}
                    <ul className="wn-checks">
                      {section.items.map((item) => (
                        <li key={item.text}>
                          <CheckIcon size={12} />
                          <span>
                            <Line text={line(item)} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** For a version from before the notes had pictures: lanes running across, one of them lit, its commit glowing. */
function LaneArt({ index }: { index: number }) {
  const from = [40, 136, 88][index % 3];
  const to = [136, 40, 40][index % 3];
  return (
    <div className="wn-art" aria-hidden="true">
      <svg viewBox="0 0 420 176" preserveAspectRatio="xMidYMid slice">
        <path className="wn-art-lane faint" d="M-10 40 H430" />
        <path className="wn-art-lane faint next" d="M-10 136 H430" />
        <path className="wn-art-lane lit" d={`M-10 ${from} C 110 ${from}, 120 88, 210 88 S 310 ${to}, 430 ${to}`} />
        <circle className="wn-art-halo" cx="210" cy="88" r="26" />
        <circle className="wn-art-node" cx="210" cy="88" r="11" />
      </svg>
    </div>
  );
}
