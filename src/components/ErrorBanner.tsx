import { Fragment, useState, type ReactNode } from "react";
import { copyText } from "../lib/clipboard";
import { ChevronRightIcon, CloseIcon, WarningIcon } from "./Icons";
import { Button } from "./ui/Button";

/** Something that can be done about an error, and what it does. */
export interface ErrorChoice {
  label: string;
  says: ReactNode;
  run: () => void;
  disabled?: boolean;
}

interface Props {
  /** What happened, in one line. */
  headline: string;
  /** Why, in a sentence or two. */
  detail?: ReactNode;
  /** Under the detail: the commits someone else pushed, say. */
  children?: ReactNode;
  /** What can be done, each with what it does. */
  choices: ErrorChoice[];
  /** git's own message, behind "Show git's message", when it says more than the headline. */
  raw?: string;
  onDismiss: () => void;
}

/**
 * An error above the commit list: what happened in plain words, then each thing that can be
 * done about it with what it does, and git's own message for whoever wants it.
 */
export function ErrorBanner({ headline, detail, children, choices, raw, onDismiss }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="error-banner error-explained" role="alert">
      <WarningIcon className="error-icon" size={16} />
      <div className="error-body">
        <strong className="error-headline">{headline}</strong>
        {detail && <p className="error-detail">{detail}</p>}
        {children}
        {choices.length > 0 && (
          <div className="error-choices">
            <div className="error-choices-title">What you can do</div>
            {choices.map((choice) => (
              <Fragment key={choice.label}>
                <button className="error-action" onClick={choice.run} disabled={choice.disabled}>
                  <span className="button-label">{choice.label}</span>
                </button>
                <span className="error-says">{choice.says}</span>
              </Fragment>
            ))}
          </div>
        )}
        {raw && (
          <div className="error-raw">
            <div className="error-raw-controls">
              <Button kind="link" className="error-raw-toggle" onClick={() => setShowRaw(!showRaw)} aria-expanded={showRaw}>
                <ChevronRightIcon size={12} className={showRaw ? "open" : undefined} />
                {showRaw ? "Hide git's message" : "Show git's message"}
              </Button>
              {showRaw && (
                <Button
                  kind="link"
                  className="error-raw-copy"
                  onClick={() =>
                    void copyText(raw).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    })
                  }
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              )}
            </div>
            {showRaw && <pre className="hook-output error-git mono">{raw}</pre>}
          </div>
        )}
      </div>
      <Button kind="icon" onClick={onDismiss} aria-label="Dismiss">
        <CloseIcon size={14} />
      </Button>
    </div>
  );
}
