//! Lane layout for the commit graph.
//!
//! Commits come in newest first, in topological order (every commit appears
//! before its parents). Each commit gets a column ("lane"), and for every row we
//! record the line segments the UI has to draw for that row:
//!
//! * [`LineKind::Pass`]   – a lane runs straight through the row, top to bottom.
//! * [`LineKind::Top`]    – a lane comes in from the top and ends in this row's node.
//! * [`LineKind::Bottom`] – a line leaves this row's node towards a parent's lane.
//!
//! Lanes never move sideways once created, so a lane's colour can simply be
//! derived from its column on the frontend. Lanes that start at a node which
//! isn't a real commit (uncommitted changes, stashes) are drawn dashed.
//!
//! Every segment also records the row(s) of the child commit(s) whose parent
//! link it draws, so the frontend can highlight one branch's history.

use serde::ser::{Serialize, SerializeTuple, Serializer};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    Pass = 0,
    Top = 1,
    Bottom = 2,
}

/// One segment within a row. Serialized compactly as `[kind, from, to, child]`,
/// where `child` is the row of the commit whose parent link this is (or a list of
/// rows when several links share the lane), with a trailing `1` when the line is
/// dashed: `[kind, from, to, child, 1]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub kind: LineKind,
    pub from: u16,
    pub to: u16,
    pub children: Vec<u32>,
    pub dashed: bool,
}

impl Line {
    fn new(kind: LineKind, from: usize, to: usize, children: Vec<u32>, dashed: bool) -> Self {
        Line {
            kind,
            from: from as u16,
            to: to as u16,
            children,
            dashed,
        }
    }
}

impl Serialize for Line {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut t = serializer.serialize_tuple(if self.dashed { 5 } else { 4 })?;
        t.serialize_element(&(self.kind as u8))?;
        t.serialize_element(&self.from)?;
        t.serialize_element(&self.to)?;
        match self.children.as_slice() {
            [single] => t.serialize_element(single)?,
            many => t.serialize_element(many)?,
        }
        if self.dashed {
            t.serialize_element(&1u8)?;
        }
        t.end()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct GraphRow {
    /// The column of this row's commit node.
    pub column: u16,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub rows: Vec<GraphRow>,
    /// The number of columns needed to draw every row.
    pub width: u16,
}

/// A row to lay out.
#[derive(Debug, Clone)]
pub struct Node<Id> {
    pub id: Id,
    pub parents: Vec<Id>,
    /// Not a real commit (uncommitted changes or a stash): lines leaving it are dashed.
    pub dashed: bool,
}

#[derive(Clone)]
struct Lane<Id> {
    /// The commit this lane is waiting for.
    expect: Id,
    /// Rows of the commits whose link to `expect` runs in this lane.
    children: Vec<u32>,
    dashed: bool,
}

/// Compute the lane layout for `nodes`, in topological order, newest first.
/// Parents that are not part of `nodes` (for example because the history was
/// truncated) keep their lane open until the last row.
pub fn layout<Id: PartialEq + Clone>(nodes: &[Node<Id>]) -> Layout {
    let mut lanes: Vec<Option<Lane<Id>>> = Vec::new();
    let mut rows = Vec::with_capacity(nodes.len());
    let mut width = 0usize;
    let waits_for =
        |lane: &Option<Lane<Id>>, id: &Id| lane.as_ref().is_some_and(|lane| &lane.expect == id);

    for (row, node) in nodes.iter().enumerate() {
        let id = &node.id;
        let row = row as u32;
        let mut lines = Vec::new();

        // Lanes that end in this commit: the commit's children point at it.
        let incoming: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter(|(_, lane)| waits_for(lane, id))
            .map(|(column, _)| column)
            .collect();

        // Upper half of the row: lanes passing through, and lanes converging into the node.
        let column = match incoming.first() {
            Some(&column) => column,
            None => take_free_lane(&mut lanes),
        };
        for (lane_column, lane) in lanes.iter().enumerate() {
            let Some(lane) = lane else { continue };
            let children = lane.children.clone();
            if &lane.expect == id {
                lines.push(Line::new(
                    LineKind::Top,
                    lane_column,
                    column,
                    children,
                    lane.dashed,
                ));
            } else {
                lines.push(Line::new(
                    LineKind::Pass,
                    lane_column,
                    lane_column,
                    children,
                    lane.dashed,
                ));
            }
        }
        for &other in incoming.iter().skip(1) {
            lanes[other] = None;
        }

        // Lower half of the row: lines from the node to each parent's lane.
        match node.parents.split_first() {
            None => lanes[column] = None,
            Some((first, rest)) => {
                lanes[column] = Some(Lane {
                    expect: first.clone(),
                    children: vec![row],
                    dashed: node.dashed,
                });
                lines.push(Line::new(
                    LineKind::Bottom,
                    column,
                    column,
                    vec![row],
                    node.dashed,
                ));

                for (i, parent) in rest.iter().enumerate() {
                    // Ignore duplicate parents, they would only draw the same line twice.
                    if parent == first || rest[..i].contains(parent) {
                        continue;
                    }
                    let target = match lanes.iter().position(|lane| waits_for(lane, parent)) {
                        Some(existing) => {
                            // Another link to the same parent already runs here: share the lane.
                            if let Some(lane) = lanes[existing].as_mut() {
                                lane.children.push(row);
                            }
                            existing
                        }
                        None => {
                            let free = take_free_lane(&mut lanes);
                            lanes[free] = Some(Lane {
                                expect: parent.clone(),
                                children: vec![row],
                                dashed: node.dashed,
                            });
                            free
                        }
                    };
                    lines.push(Line::new(
                        LineKind::Bottom,
                        column,
                        target,
                        vec![row],
                        node.dashed,
                    ));
                }
            }
        }

        width = width.max(lanes.len()).max(column + 1);
        while matches!(lanes.last(), Some(None)) {
            lanes.pop();
        }

        rows.push(GraphRow {
            column: column as u16,
            lines,
        });
    }

    Layout {
        rows,
        width: width as u16,
    }
}

/// Return the leftmost unused lane, adding a new one if every lane is in use.
fn take_free_lane<T>(lanes: &mut Vec<Option<T>>) -> usize {
    match lanes.iter().position(Option::is_none) {
        Some(free) => free,
        None => {
            lanes.push(None);
            lanes.len() - 1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use LineKind::*;

    /// A solid line drawing the link from the commit in row `child`.
    fn line(kind: LineKind, from: u16, to: u16, child: u32) -> Line {
        Line {
            kind,
            from,
            to,
            children: vec![child],
            dashed: false,
        }
    }

    fn dashed(kind: LineKind, from: u16, to: u16, child: u32) -> Line {
        Line {
            dashed: true,
            ..line(kind, from, to, child)
        }
    }

    fn commits(spec: &[(&'static str, &[&'static str])]) -> Vec<Node<&'static str>> {
        spec.iter()
            .map(|(id, parents)| Node {
                id: *id,
                parents: parents.to_vec(),
                dashed: false,
            })
            .collect()
    }

    fn columns(layout: &Layout) -> Vec<u16> {
        layout.rows.iter().map(|row| row.column).collect()
    }

    #[test]
    fn linear_history_stays_in_one_lane() {
        let result = layout(&commits(&[("c", &["b"]), ("b", &["a"]), ("a", &[])]));
        assert_eq!(result.width, 1);
        assert_eq!(result.rows[0].lines, vec![line(Bottom, 0, 0, 0)]);
        assert_eq!(
            result.rows[1].lines,
            vec![line(Top, 0, 0, 0), line(Bottom, 0, 0, 1)]
        );
        assert_eq!(result.rows[2].lines, vec![line(Top, 0, 0, 1)]);
        assert_eq!(columns(&result), vec![0, 0, 0]);
    }

    #[test]
    fn merge_opens_a_lane_that_converges_at_the_fork_point() {
        // m merges b (first parent) and c, both of which branched off a.
        let result = layout(&commits(&[
            ("m", &["b", "c"]),
            ("b", &["a"]),
            ("c", &["a"]),
            ("a", &[]),
        ]));
        assert_eq!(result.width, 2);
        assert_eq!(columns(&result), vec![0, 0, 1, 0]);
        assert_eq!(
            result.rows[0].lines,
            vec![line(Bottom, 0, 0, 0), line(Bottom, 0, 1, 0)]
        );
        assert_eq!(
            result.rows[1].lines,
            vec![
                line(Top, 0, 0, 0),
                line(Pass, 1, 1, 0),
                line(Bottom, 0, 0, 1)
            ]
        );
        assert_eq!(
            result.rows[2].lines,
            vec![
                line(Pass, 0, 0, 1),
                line(Top, 1, 1, 0),
                line(Bottom, 1, 1, 2)
            ]
        );
        assert_eq!(
            result.rows[3].lines,
            vec![line(Top, 0, 0, 1), line(Top, 1, 0, 2)]
        );
    }

    #[test]
    fn links_to_the_same_parent_share_a_lane_and_remember_both_children() {
        // "f2" continues a feature branch after "m" merged its parent "f1".
        let result = layout(&commits(&[
            ("f2", &["f1"]),
            ("m", &["a", "f1"]),
            ("f1", &["a"]),
            ("a", &[]),
        ]));
        assert_eq!(columns(&result), vec![0, 1, 0, 0]);
        // Below "m", the lane towards "f1" carries the links from both f2 (row 0) and m (row 1).
        let shared = &result.rows[2].lines[0];
        assert_eq!((shared.kind, shared.children.clone()), (Top, vec![0, 1]));
        assert_eq!(serde_json::to_string(shared).unwrap(), "[1,0,0,[0,1]]");
    }

    #[test]
    fn separate_branch_tips_get_their_own_lanes() {
        let result = layout(&commits(&[("x", &["a"]), ("y", &["a"]), ("a", &[])]));
        assert_eq!(columns(&result), vec![0, 1, 0]);
        assert_eq!(
            result.rows[1].lines,
            vec![line(Pass, 0, 0, 0), line(Bottom, 1, 1, 1)]
        );
        assert_eq!(
            result.rows[2].lines,
            vec![line(Top, 0, 0, 0), line(Top, 1, 0, 1)]
        );
    }

    #[test]
    fn freed_lanes_are_reused() {
        // After "b" closes lane 1, the unrelated tip "z" should take lane 1 again.
        let result = layout(&commits(&[
            ("m", &["a", "b"]),
            ("b", &["a"]),
            ("a", &["root"]),
            ("z", &["root"]),
            ("root", &[]),
        ]));
        assert_eq!(columns(&result), vec![0, 1, 0, 1, 0]);
        assert_eq!(result.width, 2);
    }

    #[test]
    fn missing_parents_keep_their_lane_open() {
        let result = layout(&commits(&[("b", &["a"]), ("x", &["gone"]), ("a", &[])]));
        assert_eq!(result.rows[2].column, 0);
        assert_eq!(
            result.rows[2].lines,
            vec![line(Top, 0, 0, 0), line(Pass, 1, 1, 1)]
        );
    }

    #[test]
    fn lines_from_virtual_rows_are_dashed_until_they_reach_their_parent() {
        // A stash "s" made on "b", drawn above "c" which sits between them.
        let mut nodes = commits(&[("s", &["b"]), ("c", &["b"]), ("b", &["a"]), ("a", &[])]);
        nodes[0].dashed = true;
        let result = layout(&nodes);
        assert_eq!(result.rows[0].lines, vec![dashed(Bottom, 0, 0, 0)]);
        assert_eq!(
            result.rows[1].lines,
            vec![dashed(Pass, 0, 0, 0), line(Bottom, 1, 1, 1)]
        );
        assert_eq!(
            result.rows[2].lines,
            vec![
                dashed(Top, 0, 0, 0),
                line(Top, 1, 0, 1),
                line(Bottom, 0, 0, 2)
            ]
        );
        // Below the stash's parent the lane is an ordinary, solid one again.
        assert_eq!(result.rows[3].lines, vec![line(Top, 0, 0, 2)]);
    }

    #[test]
    fn lines_serialize_compactly() {
        assert_eq!(
            serde_json::to_string(&line(Bottom, 3, 5, 7)).unwrap(),
            "[2,3,5,7]"
        );
        assert_eq!(
            serde_json::to_string(&dashed(Pass, 1, 1, 0)).unwrap(),
            "[0,1,1,0,1]"
        );
    }
}
