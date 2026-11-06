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
//! derived from its column on the frontend.

use serde::ser::{Serialize, SerializeTuple, Serializer};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    Pass = 0,
    Top = 1,
    Bottom = 2,
}

/// One segment within a row. Serialized compactly as `[kind, from, to]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Line {
    pub kind: LineKind,
    pub from: u16,
    pub to: u16,
}

impl Line {
    fn new(kind: LineKind, from: usize, to: usize) -> Self {
        Line {
            kind,
            from: from as u16,
            to: to as u16,
        }
    }
}

impl Serialize for Line {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut t = serializer.serialize_tuple(3)?;
        t.serialize_element(&(self.kind as u8))?;
        t.serialize_element(&self.from)?;
        t.serialize_element(&self.to)?;
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

/// Compute the lane layout for `commits`, given as `(id, parent ids)` pairs in
/// topological order, newest first. Parents that are not part of `commits`
/// (for example because the history was truncated) keep their lane open until
/// the last row.
pub fn layout<Id: PartialEq + Clone>(commits: &[(Id, Vec<Id>)]) -> Layout {
    // Each lane holds the id of the commit it is waiting for.
    let mut lanes: Vec<Option<Id>> = Vec::new();
    let mut rows = Vec::with_capacity(commits.len());
    let mut width = 0usize;

    for (id, parents) in commits {
        let mut lines = Vec::new();

        // Lanes that end in this commit: the commit's children point at it.
        let incoming: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter(|(_, lane)| lane.as_ref() == Some(id))
            .map(|(column, _)| column)
            .collect();

        // Upper half of the row: lanes passing through, and lanes converging into the node.
        let column = match incoming.first() {
            Some(&column) => column,
            None => take_free_lane(&mut lanes),
        };
        for (lane_column, lane) in lanes.iter().enumerate() {
            match lane {
                Some(expected) if expected == id => {
                    lines.push(Line::new(LineKind::Top, lane_column, column))
                }
                Some(_) => lines.push(Line::new(LineKind::Pass, lane_column, lane_column)),
                None => {}
            }
        }
        for &other in incoming.iter().skip(1) {
            lanes[other] = None;
        }

        // Lower half of the row: lines from the node to each parent's lane.
        match parents.split_first() {
            None => lanes[column] = None,
            Some((first, rest)) => {
                lanes[column] = Some(first.clone());
                lines.push(Line::new(LineKind::Bottom, column, column));

                for (i, parent) in rest.iter().enumerate() {
                    // Ignore duplicate parents, they would only draw the same line twice.
                    if parent == first || rest[..i].contains(parent) {
                        continue;
                    }
                    let target = match lanes.iter().position(|lane| lane.as_ref() == Some(parent)) {
                        Some(existing) => existing,
                        None => {
                            let free = take_free_lane(&mut lanes);
                            lanes[free] = Some(parent.clone());
                            free
                        }
                    };
                    lines.push(Line::new(LineKind::Bottom, column, target));
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
fn take_free_lane<Id>(lanes: &mut Vec<Option<Id>>) -> usize {
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

    fn line(kind: LineKind, from: u16, to: u16) -> Line {
        Line { kind, from, to }
    }

    fn commits(spec: &[(&'static str, &[&'static str])]) -> Vec<(&'static str, Vec<&'static str>)> {
        spec.iter().map(|(id, parents)| (*id, parents.to_vec())).collect()
    }

    #[test]
    fn linear_history_stays_in_one_lane() {
        let result = layout(&commits(&[("c", &["b"]), ("b", &["a"]), ("a", &[])]));
        assert_eq!(result.width, 1);
        assert_eq!(result.rows[0].lines, vec![line(Bottom, 0, 0)]);
        assert_eq!(result.rows[1].lines, vec![line(Top, 0, 0), line(Bottom, 0, 0)]);
        assert_eq!(result.rows[2].lines, vec![line(Top, 0, 0)]);
        assert!(result.rows.iter().all(|row| row.column == 0));
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
        let columns: Vec<u16> = result.rows.iter().map(|row| row.column).collect();
        assert_eq!(columns, vec![0, 0, 1, 0]);
        assert_eq!(result.rows[0].lines, vec![line(Bottom, 0, 0), line(Bottom, 0, 1)]);
        assert_eq!(
            result.rows[1].lines,
            vec![line(Top, 0, 0), line(Pass, 1, 1), line(Bottom, 0, 0)]
        );
        assert_eq!(
            result.rows[2].lines,
            vec![line(Pass, 0, 0), line(Top, 1, 1), line(Bottom, 1, 1)]
        );
        assert_eq!(result.rows[3].lines, vec![line(Top, 0, 0), line(Top, 1, 0)]);
    }

    #[test]
    fn separate_branch_tips_get_their_own_lanes() {
        let result = layout(&commits(&[("x", &["a"]), ("y", &["a"]), ("a", &[])]));
        let columns: Vec<u16> = result.rows.iter().map(|row| row.column).collect();
        assert_eq!(columns, vec![0, 1, 0]);
        assert_eq!(result.rows[1].lines, vec![line(Pass, 0, 0), line(Bottom, 1, 1)]);
        assert_eq!(result.rows[2].lines, vec![line(Top, 0, 0), line(Top, 1, 0)]);
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
        let columns: Vec<u16> = result.rows.iter().map(|row| row.column).collect();
        assert_eq!(columns, vec![0, 1, 0, 1, 0]);
        assert_eq!(result.width, 2);
    }

    #[test]
    fn missing_parents_keep_their_lane_open() {
        let result = layout(&commits(&[("b", &["a"]), ("x", &["gone"]), ("a", &[])]));
        assert_eq!(result.rows[2].column, 0);
        assert_eq!(result.rows[2].lines, vec![line(Top, 0, 0), line(Pass, 1, 1)]);
    }

    #[test]
    fn lines_serialize_compactly() {
        let json = serde_json::to_string(&line(Bottom, 3, 5)).unwrap();
        assert_eq!(json, "[2,3,5]");
    }
}
