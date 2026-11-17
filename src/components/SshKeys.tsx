import { useEffect, useState } from "react";
import { checkSshKey, generateSshKey, sshKeys, type SshCheck, type SshKey } from "../api";
import { copyText } from "../lib/clipboard";
import { openInBrowser } from "../lib/weblinks";
import { CheckIcon, CopyIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, KeyIcon } from "./Icons";
import { Loader } from "./Loader";
import { Button } from "./ui/Button";

/** Where GitHub takes a new SSH key. */
const GITHUB_NEW_KEY = "https://github.com/settings/ssh/new";

/** A key, its public half hidden until asked for, and whether GitHub accepts it. */
function KeyCard({ sshKey, check, checking }: { sshKey: SshKey; check: SshCheck | null; checking: boolean }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(sshKey.publicKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="ssh-key">
      <div className="ssh-key-head">
        <KeyIcon size={15} />
        <span className="ssh-key-name">{sshKey.name}</span>
        {checking ? (
          <span className="ssh-key-state">Checking GitHub…</span>
        ) : check ? (
          check.accepted ? (
            <span className="ssh-key-state accepted" title={check.message}>
              <CheckIcon size={11} />
              <span className="chip-text">GitHub knows it{check.user ? ` as ${check.user}` : ""}</span>
            </span>
          ) : (
            <span className="ssh-key-state" title={check.message}>
              <span className="chip-text">Not on GitHub</span>
            </span>
          )
        ) : null}
        <div className="ssh-key-actions">
          <Button kind="outline" onClick={() => void copy()} title="Copy the public key, to add it to GitHub or GitLab">
            {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            <span className="button-label">{copied ? "Copied" : "Copy public key"}</span>
          </Button>
          <Button
            kind="icon"
            onClick={() => setShown(!shown)}
            aria-pressed={shown}
            title={shown ? "Hide the public key" : "Show the public key (the half that's safe to share)"}
            aria-label={shown ? "Hide the public key" : "Show the public key"}
          >
            {shown ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
          </Button>
        </div>
      </div>
      <div className="ssh-key-meta">
        {sshKey.kind}
        {sshKey.comment ? ` · ${sshKey.comment}` : ""}
      </div>
      <div className="ssh-key-fingerprint">{sshKey.fingerprint}</div>
      {shown && <div className="ssh-key-public">{sshKey.publicKey}</div>}
    </div>
  );
}

/**
 * The SSH keys git uses for remotes over SSH: a card for each, and with none yet, three
 * steps to make one, add it to GitHub and check it works. Only public keys are read.
 */
export function SshKeys() {
  const [keys, setKeys] = useState<SshKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Map<string, SshCheck>>(new Map());
  const [checking, setChecking] = useState(false);
  const [making, setMaking] = useState<"closed" | "open" | "busy">("closed");
  const [name, setName] = useState("id_ed25519");
  const [passphrase, setPassphrase] = useState("");
  const [made, setMade] = useState<SshKey | null>(null);

  const load = () =>
    sshKeys()
      .then((found) => {
        setKeys(found);
        if (found.some((key) => key.name === name)) setName("id_ed25519_tributary");
      })
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
    // Once, when Settings shows the section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Ask GitHub about every key. */
  const checkAll = async (list: SshKey[]) => {
    setChecking(true);
    const next = new Map<string, SshCheck>();
    for (const key of list) {
      try {
        next.set(key.path, await checkSshKey("github.com", key.path));
      } catch (e) {
        next.set(key.path, { host: "github.com", accepted: false, user: null, message: String(e) });
      }
    }
    setChecks(next);
    setChecking(false);
  };

  const make = async () => {
    setMaking("busy");
    setError(null);
    try {
      const key = await generateSshKey(name.trim(), "", passphrase);
      setMade(key);
      setMaking("closed");
      setPassphrase("");
      await load();
    } catch (e) {
      setError(String(e));
      setMaking("open");
    }
  };

  if (keys === null && !error) return <Loader size={48} title="Reading your SSH keys" />;
  const none = keys !== null && keys.length === 0;
  const newKey = made ?? (none ? null : undefined);

  const form = (
    <div className="ssh-make">
      <label className="ssh-field">
        <span>Name</span>
        <input className="text-input mono" value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} aria-label="The new key's name" />
      </label>
      <label className="ssh-field">
        <span>Passphrase (optional)</span>
        <input className="text-input" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} aria-label="A passphrase for the new key" />
      </label>
      <Button kind="primary" onClick={() => void make()} disabled={making === "busy" || !name.trim()}>
        <span className="button-label">{making === "busy" ? "Making it…" : "Make the key"}</span>
      </Button>
    </div>
  );

  return (
    <div className="ssh-keys">
      {error && <p className="ssh-error">{error}</p>}
      {none || made ? (
        // Three steps: make a key, add it to GitHub, check it works.
        <ol className="ssh-steps">
          <li className={made ? "done" : "now"}>
            <span className="ssh-step-number">{made ? <CheckIcon size={13} /> : "1"}</span>
            <div>
              <div className="ssh-step-title">Make a key</div>
              {made ? (
                <div className="ssh-key-meta">Made {made.name}, in your .ssh folder.</div>
              ) : (
                <>
                  <div className="ssh-key-meta">You haven't got an SSH key yet. An Ed25519 key is the one to have.</div>
                  {form}
                </>
              )}
            </div>
          </li>
          <li className={made ? "now" : ""}>
            <span className="ssh-step-number">2</span>
            <div>
              <div className="ssh-step-title">Add it to GitHub</div>
              <div className="ssh-key-meta">GitHub needs the key's public half, the part that's safe to share: copy it, then paste it on GitHub's page.</div>
              {newKey && (
                <div className="ssh-step-actions">
                  <Button kind="outline" onClick={() => void copyText(newKey.publicKey)}>
                    <CopyIcon size={13} />
                    <span className="button-label">Copy public key</span>
                  </Button>
                  <Button kind="outline" onClick={() => openInBrowser(GITHUB_NEW_KEY)}>
                    <ExternalLinkIcon size={13} />
                    <span className="button-label">Open GitHub's SSH keys page</span>
                  </Button>
                </div>
              )}
            </div>
          </li>
          <li>
            <span className="ssh-step-number">3</span>
            <div>
              <div className="ssh-step-title">Check it works</div>
              <div className="ssh-key-meta">Connects to github.com and says who it knows you as.</div>
              {newKey && (
                <div className="ssh-step-actions">
                  <Button kind="outline" onClick={() => void checkAll([newKey])} disabled={checking}>
                    <span className="button-label">{checking ? "Checking…" : "Check with GitHub"}</span>
                  </Button>
                  {checks.get(newKey.path) && (
                    <span className={`ssh-key-state${checks.get(newKey.path)!.accepted ? " accepted" : ""}`}>
                      <span className="chip-text">
                        {checks.get(newKey.path)!.accepted ? `GitHub knows you${checks.get(newKey.path)!.user ? ` as ${checks.get(newKey.path)!.user}` : ""}` : "Not yet: add it on GitHub first"}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </li>
        </ol>
      ) : null}
      {!none && keys && (
        <>
          {keys.map((key) => (
            <KeyCard key={key.path} sshKey={key} check={checks.get(key.path) ?? null} checking={checking} />
          ))}
          <div className="ssh-step-actions">
            <Button kind="outline" onClick={() => void checkAll(keys)} disabled={checking}>
              <span className="button-label">{checking ? "Checking…" : "Check with GitHub"}</span>
            </Button>
            {making === "closed" && (
              <Button kind="outline" onClick={() => setMaking("open")}>
                <span className="button-label">Make a new key…</span>
              </Button>
            )}
          </div>
          {making !== "closed" && form}
        </>
      )}
    </div>
  );
}
