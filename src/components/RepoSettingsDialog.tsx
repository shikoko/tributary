import { useCallback, useEffect, useState } from "react";
import { repoIdentity, type Action, type RepoIdentity } from "../api";
import { CloudIcon, LockIcon, UserIcon } from "./Icons";
import { LfsStorageSummary } from "./LfsCleanup";
import { NameList, SettingsDialog, type SettingsSection } from "./SettingsDialog";

interface Props {
  /** The repository's folder name, and its folder. */
  name: string;
  path: string;
  protectedBranches: string[];
  setProtectedBranches: (names: string[]) => void;
  /** Runs a git action; resolves to true when it worked. */
  run: (action: Action) => Promise<boolean>;
  /** Open the Git LFS clean-up (this window closes for it). */
  onCleanUpLfs: () => void;
  onClose: () => void;
}

/** "Maya Chen <maya@example.com>", or what's missing. */
function describe(name: string | null, email: string | null): string {
  if (name && email) return `${name} <${email}>`;
  if (name || email) return `${name ?? "no name"} <${email ?? "no email"}>`;
  return "not set";
}

/**
 * One repository's own settings, from its tab's menu or the Repository menu: who commits
 * are made as here, its protected branches, and its Git LFS files.
 */
export function RepoSettingsDialog({ name, path, protectedBranches, setProtectedBranches, run, onCleanUpLfs, onClose }: Props) {
  const [identity, setIdentity] = useState<RepoIdentity | null>(null);
  const [draft, setDraft] = useState({ name: "", email: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    repoIdentity(path)
      .then((found) => {
        setIdentity(found);
        setDraft({ name: found.localName ?? "", email: found.localEmail ?? "" });
      })
      .catch(() => setIdentity({ localName: null, localEmail: null, globalName: null, globalEmail: null }));
  }, [path]);
  useEffect(load, [load]);

  const own = Boolean(identity?.localName || identity?.localEmail);
  const usual = identity ? describe(identity.globalName, identity.globalEmail) : "…";
  const changed = identity !== null && (draft.name.trim() !== (identity.localName ?? "") || draft.email.trim() !== (identity.localEmail ?? ""));
  const save = async (name: string, email: string) => {
    setSaving(true);
    await run({ kind: "setIdentity", name, email });
    setSaving(false);
    load();
  };

  const sections: SettingsSection[] = [
    {
      title: "Commits",
      icon: <UserIcon size={15} />,
      rows: [
        {
          kind: "custom",
          label: own ? `Here you commit as ${describe(identity!.localName, identity!.localEmail)}` : `Here you commit as yourself: ${usual}`,
          hint: own
            ? `Only in this repository. Everywhere else: ${usual}.`
            : "Your usual name and email, from git. To commit as someone else here (your work address, say), enter them below.",
          content: own ? (
            <button className="outline-button" onClick={() => save("", "")} disabled={saving}>
              <span className="button-label">Use my usual one</span>
            </button>
          ) : null,
        },
        {
          kind: "custom",
          label: "Name",
          content: (
            <input
              className="text-input settings-input"
              value={draft.name}
              placeholder={identity?.globalName ?? "Your name"}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              spellCheck={false}
              aria-label="Name for commits in this repository"
            />
          ),
        },
        {
          kind: "custom",
          label: "Email",
          content: (
            <input
              className="text-input settings-input"
              value={draft.email}
              placeholder={identity?.globalEmail ?? "you@example.com"}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
              spellCheck={false}
              autoCapitalize="off"
              aria-label="Email for commits in this repository"
            />
          ),
        },
        {
          kind: "custom",
          label: "",
          content: (
            <button
              className="primary-small-button"
              onClick={() => save(draft.name, draft.email)}
              disabled={saving || !changed || !draft.name.trim() || !draft.email.trim()}
            >
              {own ? "Save" : "Use for this repository"}
            </button>
          ),
        },
      ],
    },
    {
      title: "Branches",
      icon: <LockIcon size={15} />,
      rows: [
        {
          kind: "custom",
          label: "Protected branches",
          hint: "Can't be deleted; rebasing, hard resetting or force pushing them needs their name typed.",
          content: <NameList names={protectedBranches} onChange={setProtectedBranches} placeholder="Add a branch" />,
        },
      ],
    },
    {
      title: "Git LFS",
      icon: <CloudIcon size={15} />,
      rows: [
        {
          kind: "custom",
          label: "Git LFS files on this computer",
          hint: "Copies of every version you've downloaded. Cleaning up keeps what you still need.",
          content: <LfsStorageSummary repoPath={path} onCleanUp={onCleanUpLfs} />,
        },
      ],
    },
  ];
  return <SettingsDialog title={`Settings for ${name}`} sections={sections} onClose={onClose} />;
}
