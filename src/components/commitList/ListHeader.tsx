import { useRef } from "react";
import { ResizeHandle } from "../ResizeHandle";
import { clamp, MAX_DRAGGED_GRAPH_WIDTH, MAX_REFS_WIDTH, MIN_GRAPH_WIDTH, MIN_REFS_WIDTH, type ColumnOptions, type ColumnWidths, type VisibleColumns } from "./layout";

interface Props {
  columns: string;
  visible: VisibleColumns;
  options: ColumnOptions;
  narrow: boolean;
  /** The widths the branch and graph columns have now. */
  refsWidth: number;
  graphWidth: number;
  columnWidths: ColumnWidths;
  onColumnWidths: (widths: ColumnWidths) => void;
  /** Room for the scrollbar on the right. */
  scrollbar: number;
  onContextMenu: (x: number, y: number) => void;
}

/** The column headings, where the branch and graph columns can be dragged wider (double-click resets them). */
export function ListHeader({ columns, visible, options, narrow, refsWidth, graphWidth, columnWidths, onColumnWidths, scrollbar, onContextMenu }: Props) {
  /** Column widths when a drag started. */
  const dragStart = useRef({ refs: 0, graph: 0 });
  const startDrag = () => (dragStart.current = { refs: refsWidth, graph: graphWidth });
  return (
    <div
      className="list-header"
      style={{ gridTemplateColumns: columns, paddingRight: scrollbar }}
      role="presentation"
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event.clientX, event.clientY);
      }}
    >
      <div className="refs-heading">
        Branch / Tag
        <ResizeHandle
          onResizeStart={startDrag}
          onResize={(delta) => onColumnWidths({ ...columnWidths, refs: clamp(dragStart.current.refs + delta, MIN_REFS_WIDTH, MAX_REFS_WIDTH) })}
          onReset={() => onColumnWidths({ ...columnWidths, refs: null })}
        />
      </div>
      <div className="graph-heading">
        Graph
        <ResizeHandle
          onResizeStart={startDrag}
          onResize={(delta) =>
            onColumnWidths({ ...columnWidths, graph: clamp(dragStart.current.graph + delta, MIN_GRAPH_WIDTH, MAX_DRAGGED_GRAPH_WIDTH) })
          }
          onReset={() => onColumnWidths({ ...columnWidths, graph: null })}
        />
      </div>
      <div>Message</div>
      {visible.author && <div>{narrow ? "" : "Author"}</div>}
      {visible.date && <div>{options.dateKind === "committed" ? "Committed" : "Date"}</div>}
      {visible.sha && <div>SHA</div>}
    </div>
  );
}
