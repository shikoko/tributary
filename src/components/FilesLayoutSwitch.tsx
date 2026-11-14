import { useStoredState } from "../lib/settings";

export type FilesLayout = "list" | "tree";

const LAYOUTS: { value: FilesLayout; label: string; title: string }[] = [
  { value: "list", label: "List", title: "Every file, with its folder beside it" },
  { value: "tree", label: "Tree", title: "In their folders, one inside another" },
];

/** Changed files as a list, or as a tree of their folders: one choice, remembered, for every list of them. */
export function useFilesLayout() {
  return useStoredState<FilesLayout>("files.layout", "list");
}

/** List or Tree, as a small switch. */
export function FilesLayoutSwitch() {
  const [layout, setLayout] = useFilesLayout();
  return (
    <div className="diff-switch files-layout" role="group" aria-label="Show the files">
      {LAYOUTS.map((entry) => (
        <button key={entry.value} className={layout === entry.value ? "selected" : undefined} aria-pressed={layout === entry.value} onClick={() => setLayout(entry.value)} title={entry.title}>
          <span className="button-label">{entry.label}</span>
        </button>
      ))}
    </div>
  );
}
