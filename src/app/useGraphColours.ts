import { createContext, useContext, useMemo } from "react";
import type { CommitRow } from "../api";
import { graphColours, NO_COLOURS, type GraphColours } from "../lib/branchColours";
import { laneColor } from "../lib/colors";
import { ThemeContext } from "./useAppearance";

/** The colours of the open repository's commits and lines (branchColours.ts). */
export const GraphColoursContext = createContext<GraphColours>(NO_COLOURS);

/** The colours of `commits`, the way Settings says, worked out again when either changes. */
export function useGraphColours(commits: CommitRow[]): GraphColours {
  const { branches } = useContext(ThemeContext);
  return useMemo(() => graphColours(commits, branches), [commits, branches]);
}

/** A commit's colour in the graph: its branch's, or its lane's when it hasn't one. */
export function useCommitColour(commit: CommitRow): string {
  const graph = useContext(GraphColoursContext);
  const { colors } = useContext(ThemeContext);
  return graph.byId.get(commit.id)?.node ?? laneColor(commit.graph.column, colors.lanes);
}
