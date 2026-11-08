import { useState } from "react";
import { setDiffTool, type DiffToolSettings } from "../api";
import { diffToolsChanged, toolLabel, useDiffTools } from "../lib/diffTools";
import type { SettingRow } from "./SettingsDialog";

interface Options {
  /** Only looked up while Settings is open. */
  open: boolean;
  repoPath: string | null;
  notify: (text: string) => void;
}

/** The commands' placeholders, for the "Custom command" field. */
const PLACEHOLDERS = { diff: 'mytool "$LOCAL" "$REMOTE"', merge: 'mytool "$BASE" "$LOCAL" "$REMOTE" "$MERGED"' };

/**
 * Settings' "Diff and merge" rows: which tool opens a file's changes, and which one
 * resolves conflicts. They're git's own settings, so git uses them too.
 */
export function useDiffToolRows({ open, repoPath, notify }: Options): SettingRow[] {
  const settings = useDiffTools(repoPath, true, open);
  const [custom, setCustom] = useState<{ diff: string | null; merge: string | null }>({ diff: null, merge: null });
  if (!open) return [];
  if (!settings) return [{ kind: "custom", label: "Looking for tools…", content: null }];

  const save = (kind: "diff" | "merge", tool: string | null, command: string | null = null) =>
    setDiffTool(repoPath, kind === "merge", tool, command)
      .then((message) => {
        notify(message);
        setCustom((current) => ({ ...current, [kind]: null }));
        diffToolsChanged();
      })
      .catch((e) => notify(String(e)));

  const rows: SettingRow[] = [];
  for (const kind of ["diff", "merge"] as const) {
    rows.push(...toolRows(kind, settings, custom[kind], (draft) => setCustom((current) => ({ ...current, [kind]: draft })), save));
  }
  return rows;
}

function toolRows(
  kind: "diff" | "merge",
  settings: DiffToolSettings,
  draft: string | null,
  setDraft: (draft: string | null) => void,
  save: (kind: "diff" | "merge", tool: string | null, command?: string | null) => void,
): SettingRow[] {
  const current = kind === "diff" ? settings.diff : settings.merge;
  const command = kind === "diff" ? settings.diffCommand : settings.mergeCommand;
  const tools = settings.available.filter((tool) => tool[kind]);
  const options = [
    { value: "", label: "Not chosen" },
    ...tools.map((tool) => ({ value: tool.name, label: tool.label })),
    ...(current && current !== "custom" && !tools.some((tool) => tool.name === current) ? [{ value: current, label: toolLabel(current) }] : []),
    { value: "custom", label: "A command of my own…" },
  ];
  const editing = draft !== null || current === "custom";
  const rows: SettingRow[] = [
    {
      kind: "select",
      label: kind === "diff" ? "Diff tool" : "Merge tool",
      hint:
        kind === "diff"
          ? "Opens a file's changes side by side, from “Open in diff tool”. Saved in git's settings (diff.tool), so git difftool uses it too."
          : "Resolves a conflicted file, from “Open in merge tool”. Saved in git's settings (merge.tool), so git mergetool uses it too.",
      value: draft !== null ? "custom" : (current ?? ""),
      options,
      set: (value) => {
        if (value === "custom") setDraft(command ?? "");
        else save(kind, value || null);
      },
    },
  ];
  if (editing) {
    const text = draft ?? command ?? "";
    rows.push({
      kind: "custom",
      label: "Command",
      hint: kind === "diff" ? "$LOCAL and $REMOTE are the two versions." : "$MERGED is the file to resolve; $BASE, $LOCAL and $REMOTE are the versions it came from.",
      content: (
        <span className="settings-inline">
          <input
            className="text-input settings-input"
            value={text}
            placeholder={PLACEHOLDERS[kind]}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && text.trim() && save(kind, "custom", text)}
            spellCheck={false}
            aria-label={`Command for the ${kind} tool`}
          />
          <button className="outline-button" onClick={() => save(kind, "custom", text)} disabled={!text.trim() || (draft === null && current === "custom")}>
            <span className="button-label">Save</span>
          </button>
        </span>
      ),
    });
  }
  return rows;
}
