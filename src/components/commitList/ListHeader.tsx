import { useRef } from "react";
import { ViewIcon } from "../Icons";
import { ResizeHandle } from "../ResizeHandle";
import { Button } from "../ui/Button";
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
  /** Opens the View panel under the button at the end of the headings. */
  onViewMenu: (anchor: HTMLElement) => void;
}

/**
 * The column headings, where the branch and graph columns can be dragged wider (double-click
 * resets them), and at their end the View button: how the list and its graph look.
 */
export function ListHeader({ columns, visible, options, narrow, refsWidth, graphWidth, columnWidths, onColumnWidths, scrollbar, onContextMenu, onViewMenu }: Props) {
  const view = useRef<HTMLButtonElement>(null);
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
        <span className="list-heading-text">Branch / Tag</span>
        <ResizeHandle
          onResizeStart={startDrag}
          onResize={(delta) => onColumnWidths({ ...columnWidths, refs: clamp(dragStart.current.refs + delta, MIN_REFS_WIDTH, MAX_REFS_WIDTH) })}
          onReset={() => onColumnWidths({ ...columnWidths, refs: null })}
        />
      </div>
      <div className="graph-heading">
        <span className="list-heading-text">Graph</span>
        <ResizeHandle
          onResizeStart={startDrag}
          onResize={(delta) =>
            onColumnWidths({ ...columnWidths, graph: clamp(dragStart.current.graph + delta, MIN_GRAPH_WIDTH, MAX_DRAGGED_GRAPH_WIDTH) })
          }
          onReset={() => onColumnWidths({ ...columnWidths, graph: null })}
        />
      </div>
      <div className="message-heading">
        <span className="list-heading-text">Message</span>
      </div>
      {visible.author && (
        <div className="author-heading">
          <span className="list-heading-text">{narrow ? "" : "Author"}</span>
        </div>
      )}
      {visible.date && (
        <div className="date-heading">
          <span className="list-heading-text">{options.dateKind === "committed" ? "Committed" : "Date"}</span>
        </div>
      )}
      {visible.sha && (
        <div className="sha-heading">
          <span className="list-heading-text">SHA</span>
        </div>
      )}
      <Button ref={view} kind="icon" className="list-header-view" style={{ right: scrollbar }} onClick={() => view.current && onViewMenu(view.current)} title="View options" aria-label="View options">
        <ViewIcon size={14} />
      </Button>
    </div>
  );
}
