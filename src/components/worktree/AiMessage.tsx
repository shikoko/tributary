import { useRef, useState } from "react";
import { asAppError, writeCommitMessage, type MessageStyle, type WrittenMessage } from "../../api";
import { AI_SECTION, STYLES, useAiSettings, writtenDetail, writtenNote } from "../../lib/ai";
import { ContextMenu } from "../ContextMenu";
import { AiIcon, ChevronDownIcon, SpinnerIcon } from "../Icons";
import { Button } from "../ui/Button";
import type { CommitDraft } from "./CommitBox";

interface Options {
  path: string;
  draft: CommitDraft;
  onDraft: (draft: CommitDraft) => void;
  stagedCount: number;
  openSettings: (section: string) => void;
}

/**
 * Writing the commit message with AI, from the staged changes: the sparkle in the summary
 * field (with a menu of how it's written), the line under the message saying who wrote it,
 * with Try again and Undo, and the first time, an offer to set it up.
 */
export function useAiMessage({ path, draft, onDraft, stagedCount, openSettings }: Options) {
  const settings = useAiSettings();
  const [writing, setWriting] = useState(false);
  // What the AI wrote, and the message from before, for Undo.
  const [written, setWritten] = useState<{ message: WrittenMessage; before: { summary: string; description: string } } | null>(null);
  const [failed, setFailed] = useState<{ message: string; setup: boolean } | null>(null);
  // Only while the message is still the AI's: changed by hand (or committed), it's yours.
  const shown = written && draft.summary === written.message.summary && draft.description === written.message.description ? written : null;

  const write = async (style: MessageStyle = settings.style) => {
    if (writing) return;
    // Trying again starts from what you'd written, not from the AI's last go.
    const before = shown?.before ?? { summary: draft.summary, description: draft.description };
    setWriting(true);
    setFailed(null);
    try {
      const message = await writeCommitMessage(path, settings.setup, style, before.summary);
      setWritten({ message, before });
      onDraft({ ...draft, summary: message.summary, description: message.description });
    } catch (reason) {
      const error = asAppError(reason);
      setFailed({ message: error.message, setup: error.kind?.kind === "aiSetup" });
    } finally {
      setWriting(false);
    }
  };
  const undo = () => {
    if (!shown) return;
    onDraft({ ...draft, ...shown.before });
    setWritten(null);
  };

  const button = settings.on ? (
    <AiButton
      writing={writing}
      disabled={stagedCount === 0 && !draft.amend}
      style={settings.style}
      onWrite={() => void write()}
      onStyle={(style) => {
        settings.setStyle(style);
        void write(style);
      }}
      onSettings={() => openSettings(AI_SECTION)}
    />
  ) : null;

  const note = !settings.on ? null : failed ? (
    <div className="ai-note failed" role="alert">
      <span className="ai-note-text">{failed.message}</span>
      {failed.setup && (
        <Button kind="link" onClick={() => openSettings(AI_SECTION)}>
          AI settings…
        </Button>
      )}
      <Button kind="link" onClick={() => setFailed(null)}>
        Dismiss
      </Button>
    </div>
  ) : shown ? (
    <div className="ai-note" title={writtenDetail(shown.message)}>
      <AiIcon size={12} className="ai-mark" />
      <span className="ai-note-text">{writtenNote(shown.message)}</span>
      <Button kind="link" onClick={() => void write()} disabled={writing}>
        Try again
      </Button>
      <span className="ai-note-dot" aria-hidden="true">
        ·
      </span>
      <Button kind="link" onClick={undo} disabled={writing}>
        Undo
      </Button>
    </div>
  ) : null;

  // The first time there's something staged: an offer to set it up, until it's answered.
  const offer =
    !settings.on && !settings.offered && stagedCount > 0 ? (
      <div className="ai-offer">
        <span className="ai-offer-title">
          <AiIcon size={13} className="ai-mark" />
          Write commit messages with AI
        </span>
        <p className="ai-offer-text">Your staged changes go to the AI you choose, with your own key, only when you ask. Nothing goes through Tributary.</p>
        <div className="ai-offer-buttons">
          <Button
            kind="primary"
            onClick={() => {
              settings.setOffered(true);
              settings.setOn(true);
              openSettings(AI_SECTION);
            }}
          >
            Set up…
          </Button>
          <Button kind="secondary" onClick={() => settings.setOffered(true)}>
            Not now
          </Button>
        </div>
      </div>
    ) : null;

  return { button, note, offer, writing };
}

/** The sparkle at the end of the summary field, and beside it the menu of how it writes. */
function AiButton({
  writing,
  disabled,
  style,
  onWrite,
  onStyle,
  onSettings,
}: {
  writing: boolean;
  disabled: boolean;
  style: MessageStyle;
  onWrite: () => void;
  onStyle: (style: MessageStyle) => void;
  onSettings: () => void;
}) {
  const more = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; above: number } | null>(null);
  return (
    <>
      <span className="ai-write">
        <button
          type="button"
          className="ai-write-go"
          onClick={onWrite}
          disabled={disabled || writing}
          aria-busy={writing}
          title={disabled ? "Stage the changes the message is for first" : writing ? "Writing the message…" : "Write the message with AI, from the staged changes"}
          aria-label="Write the message with AI"
        >
          {writing ? <SpinnerIcon size={13} className="spinning" /> : <AiIcon size={13} />}
        </button>
        <button
          ref={more}
          type="button"
          className="ai-write-more"
          onClick={() => {
            const box = more.current?.getBoundingClientRect();
            if (box) setMenu({ x: box.right - 240, y: box.bottom + 2, above: box.top - 2 });
          }}
          disabled={writing}
          title="How the message is written"
          aria-label="How the message is written"
          aria-haspopup="menu"
        >
          <ChevronDownIcon size={10} />
        </button>
      </span>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          above={menu.above}
          onClose={() => setMenu(null)}
          items={[
            ...STYLES.map((choice) => ({
              label: choice.label,
              detail: choice.detail,
              checked: choice.value === style,
              disabled,
              onSelect: () => onStyle(choice.value),
            })),
            { label: "AI settings…", separated: true, onSelect: onSettings },
          ]}
        />
      )}
    </>
  );
}
