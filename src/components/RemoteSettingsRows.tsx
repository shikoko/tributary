import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { moveCheck, remotes as listRemotes, type Action, type MoveCheck, type RememberedChoice, type RemoteInfo } from "../api";
import { MoveRemoteDialog } from "./MoveRemoteDialog";
import type { SettingRow } from "./SettingsDialog";
import { Button } from "./ui/Button";

/** A remote being changed: its name and addresses as typed. */
interface Editing {
  name: string;
  draft: { name: string; url: string; pushUrl: string };
}

/**
 * The repository's remotes, in its settings: each one's address (and push address), to
 * rename, point elsewhere or remove, and a form to add one.
 */
export function useRemoteRows(path: string, run: (action: Action) => Promise<boolean>): SettingRow[] {
  const [remotes, setRemotes] = useState<RemoteInfo[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState({ name: "", url: "" });
  const [busy, setBusy] = useState(false);
  /** A new address that lacks branches remembered from the old one: asked about first. */
  const [moving, setMoving] = useState<{ remote: RemoteInfo; url: string; check: MoveCheck; rest: Action[] } | null>(null);
  const load = useCallback(() => {
    listRemotes(path)
      .then(setRemotes)
      .catch(() => setRemotes([]));
  }, [path]);
  useEffect(load, [load]);

  /** Run actions one after another, stopping at the first that fails. */
  const apply = async (actions: Action[]) => {
    setBusy(true);
    let ok = true;
    for (const action of actions) {
      if (!(await run(action))) {
        ok = false;
        break;
      }
    }
    setBusy(false);
    load();
    return ok;
  };

  if (!remotes) return [{ kind: "loading", label: "Reading the remotes" }];

  const saveEdit = async (remote: RemoteInfo, draft: Editing["draft"]) => {
    const name = draft.name.trim();
    const url = draft.url.trim();
    // The rename last: what comes before it uses the remote's name as it is.
    const rest: Action[] = [];
    if (draft.pushUrl.trim() !== (remote.pushUrl ?? "")) rest.push({ kind: "setRemoteUrl", name: remote.name, url: draft.pushUrl, push: true });
    if (name !== remote.name) rest.push({ kind: "renameRemote", from: remote.name, to: name });
    // Addresses with a password or token in them show without it: unchanged, they're left alone.
    if (url !== remote.url) {
      // A new address without branches only remembered from the old one would lose their
      // work at the next fetch: asked about first. (When it can't be checked at all, the
      // address change itself says what's wrong.)
      setBusy(true);
      const check = await moveCheck(path, remote.name, url).catch(() => null);
      setBusy(false);
      if (check && check.missing.length > 0) {
        setMoving({ remote, url, check, rest });
        return;
      }
      rest.unshift({ kind: "setRemoteUrl", name: remote.name, url, push: false });
    }
    if (rest.length === 0 || (await apply(rest))) setEditing(null);
  };

  const move = async (then: RememberedChoice) => {
    if (!moving) return;
    const { remote, url, check, rest } = moving;
    const moved: Action = { kind: "moveRemote", name: remote.name, url, then, branches: check.missing.map((branch) => branch.name), local: check.local };
    const ok = await apply([moved, ...rest]);
    setMoving(null);
    if (ok) setEditing(null);
  };

  const rows: SettingRow[] = [];
  if (remotes.length === 0) {
    rows.push({ kind: "custom", label: "No remotes yet", hint: "Add one to fetch from it and push to it, like the repository on GitHub.", content: null });
  }
  for (const remote of remotes) {
    if (editing?.name === remote.name) {
      const { draft } = editing;
      // From the draft as it is now, not as this render saw it: two changes before the next
      // render (typing quickly, or a field filled by the system) would otherwise undo the first.
      const set = (change: Partial<Editing["draft"]>) => setEditing((current) => current && { ...current, draft: { ...current.draft, ...change } });
      rows.push({
        kind: "custom",
        label: `Edit ${remote.name}`,
        hint: remote.hasCredentials ? "Its address has a password or token in it, which isn't shown. Change the address to replace it." : undefined,
        content: (
          <form
            className="remote-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveEdit(remote, draft);
            }}
          >
            <input className="text-input settings-input" value={draft.name} onChange={(event) => set({ name: event.target.value })} spellCheck={false} aria-label="Name" placeholder="Name" />
            <input className="text-input settings-input" value={draft.url} onChange={(event) => set({ url: event.target.value })} spellCheck={false} aria-label="Address" placeholder="https://github.com/team/app.git" autoFocus />
            <input
              className="text-input settings-input"
              value={draft.pushUrl}
              onChange={(event) => set({ pushUrl: event.target.value })}
              spellCheck={false}
              aria-label="Push address"
              placeholder="Push address (optional: the same one)"
            />
            <div className="remote-form-buttons">
              <Button type="button" kind="outline" onClick={() => setEditing(null)} disabled={busy}>
                <span className="button-label">Cancel</span>
              </Button>
              <Button type="submit" kind="primary" disabled={busy || !draft.name.trim() || !draft.url.trim()}>
                {busy && draft.url.trim() !== remote.url && !moving ? "Checking the address…" : "Save"}
              </Button>
            </div>
            {moving &&
              createPortal(
                <MoveRemoteDialog remote={remote.name} from={remote.url} check={moving.check} busy={busy} onCancel={() => setMoving(null)} onMove={(then) => void move(then)} />,
                document.body,
              )}
          </form>
        ),
      });
      continue;
    }
    rows.push({
      kind: "custom",
      label: remote.name,
      hint: [remote.url, remote.pushUrl && `Pushes to ${remote.pushUrl}`, remote.hasCredentials && "(with a saved password or token)"].filter(Boolean).join(" · "),
      content:
        removing === remote.name ? (
          <div className="remote-buttons">
            <span className="remote-confirm">Its remote branches go too.</span>
            <Button kind="outline" onClick={() => setRemoving(null)} disabled={busy}>
              <span className="button-label">Keep</span>
            </Button>
            <Button
              kind="danger"
              disabled={busy}
              onClick={() => {
                setRemoving(null);
                void apply([{ kind: "removeRemote", name: remote.name }]);
              }}
            >
              Remove
            </Button>
          </div>
        ) : (
          <div className="remote-buttons">
            <Button
              kind="outline"
              disabled={busy}
              onClick={() => setEditing({ name: remote.name, draft: { name: remote.name, url: remote.url, pushUrl: remote.pushUrl ?? "" } })}
              aria-label={`Edit ${remote.name}`}
            >
              <span className="button-label">Edit…</span>
            </Button>
            <Button kind="outline" disabled={busy} onClick={() => setRemoving(remote.name)} aria-label={`Remove ${remote.name}`}>
              <span className="button-label">Remove…</span>
            </Button>
          </div>
        ),
    });
  }
  const add = async () => {
    if (await apply([{ kind: "addRemote", name: adding.name, url: adding.url }])) setAdding({ name: "", url: "" });
  };
  rows.push({
    kind: "custom",
    label: "Add a remote",
    hint: "Its branches show up after the next fetch.",
    content: (
      <form
        className="remote-form"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          className="text-input settings-input"
          value={adding.name}
          onChange={(event) => {
            const name = event.target.value;
            setAdding((current) => ({ ...current, name }));
          }}
          placeholder={remotes.some((remote) => remote.name === "origin") ? "upstream" : "origin"}
          spellCheck={false}
          aria-label="New remote's name"
        />
        <input
          className="text-input settings-input"
          value={adding.url}
          onChange={(event) => {
            const url = event.target.value;
            setAdding((current) => ({ ...current, url }));
          }}
          placeholder="https://github.com/team/app.git"
          spellCheck={false}
          aria-label="New remote's address"
        />
        <div className="remote-form-buttons">
          <Button type="submit" kind="primary" disabled={busy || !adding.name.trim() || !adding.url.trim()}>
            Add remote
          </Button>
        </div>
      </form>
    ),
  });
  return rows;
}
