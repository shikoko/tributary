import { useEffect, useMemo, useState } from "react";
import { thirdPartyNotices } from "../api";
import { openInBrowser } from "../lib/weblinks";
import { parseNotices, searchNotices, type NoticePackage } from "../lib/notices";
import { Dialog } from "./Dialog";
import { ExternalLinkIcon, SearchIcon } from "./Icons";

/** Tributary's own entry, first in the list. */
const OWN = "tributary";

/**
 * The licences of everything Tributary is made with, laid out like Settings: the packages
 * on the left (with a search), the chosen one's licence on the right. Tributary's own
 * licence comes first.
 */
export function LicencesDialog({ onClose }: { onClose: () => void }) {
  const [packages, setPackages] = useState<NoticePackage[] | null>(null);
  const [own, setOwn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(OWN);

  useEffect(() => {
    let live = true;
    thirdPartyNotices()
      .then((found) => {
        if (!live) return;
        setPackages(parseNotices(found.notices));
        setOwn(found.license);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => searchNotices(packages ?? [], query), [packages, query]);
  const selected = chosen === OWN ? null : (packages?.find((entry) => key(entry) === chosen) ?? null);

  return (
    <Dialog
      title="Third-party licences"
      className="settings-window licences-window"
      closable
      error={error}
      onCancel={onClose}
      buttons={
        <button className="secondary-button" onClick={onClose} autoFocus>
          Done
        </button>
      }
    >
      <div className="settings">
        <nav className="settings-nav licences-nav" aria-label="Packages">
          <label className="licences-search">
            <SearchIcon size={13} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search packages or licences" aria-label="Search packages or licences" spellCheck={false} />
          </label>
          {!query && (
            <button className={`settings-tab${chosen === OWN ? " selected" : ""}`} onClick={() => setChosen(OWN)}>
              <span className="settings-tab-text">
                <span>Tributary</span>
                <span className="settings-tab-subtitle">MIT License</span>
              </span>
            </button>
          )}
          {packages === null && !error && <p className="licences-empty">Reading the licences…</p>}
          {packages !== null && shown.length === 0 && <p className="licences-empty">No package matches “{query}”.</p>}
          {shown.map((entry) => (
            <button key={key(entry)} className={`settings-tab${chosen === key(entry) ? " selected" : ""}`} onClick={() => setChosen(key(entry))} title={`${entry.name} ${entry.version}`}>
              <span className="settings-tab-text">
                <span className="licences-name">{entry.name}</span>
                <span className="settings-tab-subtitle">
                  {entry.version} · {entry.license}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <section className="settings-panel licences-panel">
          {selected ? (
            <>
              <h3>
                {selected.name}
                <span className="settings-panel-subtitle">
                  Version {selected.version} · {selected.license}
                </span>
              </h3>
              <button className="link-button licences-home" onClick={() => openInBrowser(selected.home)}>
                <ExternalLinkIcon size={12} />
                <span>{selected.home.replace(/^https?:\/\//, "")}</span>
              </button>
              {selected.texts.length === 0 ? (
                <p className="licences-note">This package doesn't come with a licence file: its licence is the standard text of {selected.license}.</p>
              ) : (
                selected.texts.map((text, index) => (
                  <pre key={index} className="licences-text">
                    {text}
                  </pre>
                ))
              )}
            </>
          ) : (
            <>
              <h3>
                Tributary
                <span className="settings-panel-subtitle">MIT License</span>
              </h3>
              <p className="licences-note">
                Tributary is free and open source, under the MIT License below.
                {packages && ` It's made with ${packages.length} open-source packages, each under its own licence: they're listed on the left.`}
              </p>
              {own ? <pre className="licences-text">{own}</pre> : <p className="licences-note">The licence text wasn't installed with this copy: it's the LICENSE file in Tributary's source code.</p>}
            </>
          )}
        </section>
      </div>
    </Dialog>
  );
}

const key = (entry: NoticePackage) => `${entry.name}@${entry.version}`;
