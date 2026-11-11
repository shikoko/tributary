import { useCallback, useEffect, useState } from "react";
import { remotes as listRemotes, type Action, type RemoteInfo } from "../api";
import type { SettingRow } from "./SettingsDialog";

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
    const actions: Action[] = [];
    // Addresses with a password or token in them show without it: unchanged, they're left alone.
    if (draft.url.trim() !== remote.url) actions.push({ kind: "setRemoteUrl", name: remote.name, url: draft.url, push: false });
    if (draft.pushUrl.trim() !== (remote.pushUrl ?? "")) actions.push({ kind: "setRemoteUrl", name: remote.name, url: draft.pushUrl, push: true });
    if (name !== remote.name) actions.push({ kind: "renameRemote", from: remote.name, to: name });
    if (actions.length === 0 || (await apply(actions))) setEditing(null);
  };

  const rows: SettingRow[] = [];
  if (remotes.length === 0) {
    rows.push({ kind: "custom", label: "No remotes yet", hint: "Add one to fetch from it and push to it, like the repository on GitHub.", content: null });
  }
  for (const remote of remotes) {
    if (editing?.name === remote.name) {
      const { draft } = editing;
      const set = (change: Partial<Editing["draft"]>) => setEditing({ ...editing, draft: { ...draft, ...change } });
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
              <button type="button" className="outline-button" onClick={() => setEditing(null)} disabled={busy}>
                <span className="button-label">Cancel</span>
              </button>
              <button type="submit" className="primary-small-button" disabled={busy || !draft.name.trim() || !draft.url.trim()}>
                Save
              </button>
            </div>
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
            <button className="outline-button" onClick={() => setRemoving(null)} disabled={busy}>
              <span className="button-label">Keep</span>
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() => {
                setRemoving(null);
                void apply([{ kind: "removeRemote", name: remote.name }]);
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="remote-buttons">
            <button
              className="outline-button"
              disabled={busy}
              onClick={() => setEditing({ name: remote.name, draft: { name: remote.name, url: remote.url, pushUrl: remote.pushUrl ?? "" } })}
              aria-label={`Edit ${remote.name}`}
            >
              <span className="button-label">Edit…</span>
            </button>
            <button className="outline-button" disabled={busy} onClick={() => setRemoving(remote.name)} aria-label={`Remove ${remote.name}`}>
              <span className="button-label">Remove…</span>
            </button>
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
          onChange={(event) => setAdding({ ...adding, name: event.target.value })}
          placeholder={remotes.some((remote) => remote.name === "origin") ? "upstream" : "origin"}
          spellCheck={false}
          aria-label="New remote's name"
        />
        <input
          className="text-input settings-input"
          value={adding.url}
          onChange={(event) => setAdding({ ...adding, url: event.target.value })}
          placeholder="https://github.com/team/app.git"
          spellCheck={false}
          aria-label="New remote's address"
        />
        <div className="remote-form-buttons">
          <button type="submit" className="primary-small-button" disabled={busy || !adding.name.trim() || !adding.url.trim()}>
            Add remote
          </button>
        </div>
      </form>
    ),
  });
  return rows;
}
