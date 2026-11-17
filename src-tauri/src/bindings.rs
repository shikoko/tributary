//! The TypeScript types for what the commands take and give back, and for the events, made
//! from the Rust types so the two sides can't drift apart: `src/api/generated.ts`. The
//! commands' types come from the command list (`commands/list.rs`), which also gives
//! `Commands`, each command's arguments and result.
//!
//! The test below makes the file from the types listed in [`generate`] and every type they
//! use, and compares it with the one in the repository. If they differ, it writes the new
//! one and fails, so a change to a Rust type shows up as a change to commit (and `tsc` then
//! shows what it means for the front end).

use std::any::TypeId;
use std::collections::{BTreeMap, HashSet};

use ts_rs::{Config, TS, TypeVisitor};

use crate::{git, updates};

/// Where the file goes, from the crate's folder.
const FILE: &str = "../src/api/generated.ts";

const HEADER: &str = "\
// Made from the Rust types by a test (src-tauri/src/bindings.rs), so don't change it by
// hand: change the Rust type, and `cargo test` brings this file up to date.
";

/// Every type a visited type uses, with its declaration, by its name in TypeScript.
struct Collect {
    config: Config,
    seen: HashSet<TypeId>,
    found: BTreeMap<String, String>,
}

impl TypeVisitor for Collect {
    fn visit<T: TS + 'static + ?Sized>(&mut self) {
        // Only types with a declaration of their own: not strings, lists and the like, but
        // what's in a list, an option or a map is.
        if T::output_path().is_none() {
            T::visit_generics(self);
            return;
        }
        if !self.seen.insert(TypeId::of::<T>()) {
            return;
        }
        let name = T::ident(&self.config);
        let mut text = T::docs().unwrap_or_default();
        text.push_str("export ");
        text.push_str(&T::decl(&self.config));
        if let Some(other) = self.found.insert(name.clone(), text) {
            panic!(
                "Two Rust types are both called {name} in TypeScript: rename one with #[ts(rename = \"…\")]\n{other}"
            );
        }
        T::visit_dependencies(self);
    }
}

/// The file's text: the types the commands take and give back, and the events' payloads,
/// with everything they use.
fn generate() -> String {
    let mut collect = Collect {
        // serde_json writes 64-bit numbers as plain numbers, so they're `number`s.
        config: Config::new().with_large_int("number"),
        seen: HashSet::new(),
        found: BTreeMap::new(),
    };
    let c = &mut collect;
    // What the commands take and give back, from the command list.
    crate::commands::visit_types(c);
    // What a command that fails gives back.
    c.visit::<crate::error::Failure>();
    // The events' payloads.
    c.visit::<git::Progress>();
    c.visit::<updates::DownloadProgress>();

    let commands = commands(&collect.config);
    collect.found.insert("Commands".into(), commands);

    let mut text = String::from(HEADER);
    for declaration in collect.found.values() {
        text.push('\n');
        text.push_str(&layout(declaration));
        text.push('\n');
    }
    text
}

/// `Commands`: each command's arguments (as the frontend sends them, in camelCase, an
/// `Option` one optional) and what it gives back, for `invoke` in `src/api/invoke.ts`.
fn commands(config: &Config) -> String {
    let mut members = String::new();
    for signature in crate::commands::signatures(config) {
        let args: String = signature
            .args
            .iter()
            .map(|(name, ts)| {
                let optional = if ts.ends_with("| null") { "?" } else { "" };
                format!("{}{optional}: {ts}, ", crate::commands::camel(name))
            })
            .collect();
        // None at all: an object with nothing in it.
        let args = if args.is_empty() {
            "Record<string, never>".to_owned()
        } else {
            format!("{{ {args}}}")
        };
        members.push_str(&format!(
            "{}: {{ args: {args}, returns: {}, }}, ",
            signature.name, signature.returns
        ));
    }
    format!(
        "/**\n * Every command the frontend can call: what it takes (its arguments, as the frontend\n * \
         sends them) and what it gives back. Made from the command list\n * \
         (src-tauri/src/commands/list.rs).\n */\nexport type Commands = {{ {members}}};"
    )
}

/// How wide a line may be before a type is spread over several.
const WIDTH: usize = 100;

/// Part of a declaration: plain text, a doc comment, or something in brackets (an object,
/// a tuple, a list's `[]` or a generic's `<…>`), split at its commas.
enum Piece {
    Text(String),
    Comment(String),
    Group(char, Vec<Vec<Piece>>),
}

/// The pieces up to `close` (or the end), split at the commas when in brackets.
fn parse(chars: &[char], at: &mut usize, close: Option<char>) -> Vec<Vec<Piece>> {
    let mut members = vec![vec![]];
    let mut text = String::new();
    let flush = |text: &mut String, member: &mut Vec<Piece>| {
        if !text.is_empty() {
            member.push(Piece::Text(std::mem::take(text)));
        }
    };
    while *at < chars.len() {
        let c = chars[*at];
        *at += 1;
        let member = members.last_mut().expect("there's always a member");
        match c {
            '/' if chars.get(*at) == Some(&'*') => {
                flush(&mut text, member);
                let mut comment = String::from("/");
                while *at < chars.len() && !comment.ends_with("*/") {
                    comment.push(chars[*at]);
                    *at += 1;
                }
                member.push(Piece::Comment(comment));
            }
            '"' => {
                text.push('"');
                while *at < chars.len() {
                    let c = chars[*at];
                    *at += 1;
                    text.push(c);
                    if c == '\\' && *at < chars.len() {
                        text.push(chars[*at]);
                        *at += 1;
                    } else if c == '"' {
                        break;
                    }
                }
            }
            '{' | '[' | '<' => {
                flush(&mut text, member);
                let end = match c {
                    '{' => '}',
                    '[' => ']',
                    _ => '>',
                };
                member.push(Piece::Group(c, parse(chars, at, Some(end))));
            }
            ',' if close.is_some() => {
                flush(&mut text, member);
                members.push(vec![]);
            }
            c if Some(c) == close => {
                flush(&mut text, member);
                break;
            }
            c if c.is_whitespace() => {
                if !text.ends_with(' ') {
                    text.push(' ');
                }
            }
            c => text.push(c),
        }
    }
    let member = members.last_mut().expect("there's always a member");
    flush(&mut text, member);
    // ts-rs ends members with a comma, which leaves an empty one last.
    members.retain(|member| {
        member
            .iter()
            .any(|piece| !matches!(piece, Piece::Text(text) if text.trim().is_empty()))
    });
    members
}

/// A member on one line, if it has no comments.
fn flat(member: &[Piece]) -> Option<String> {
    let mut out = String::new();
    for piece in member {
        match piece {
            Piece::Text(text) => out.push_str(text),
            Piece::Comment(_) => return None,
            Piece::Group(open, members) => {
                let inner = members
                    .iter()
                    .map(|m| flat(m))
                    .collect::<Option<Vec<_>>>()?;
                out.push_str(&match open {
                    '{' if inner.is_empty() => "{}".to_string(),
                    '{' => format!("{{ {} }}", inner.join("; ")),
                    '[' => format!("[{}]", inner.join(", ")),
                    _ => format!("<{}>", inner.join(", ")),
                });
            }
        }
    }
    Some(tidy(&out))
}

/// A member's text without the spaces at its ends, and its key unquoted when it can be.
fn tidy(text: &str) -> String {
    let text = text.trim();
    if let Some(rest) = text.strip_prefix('"')
        && let Some((key, after)) = rest.split_once('"')
        && (after.starts_with(':') || after.starts_with("?:"))
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !key.starts_with(|c: char| c.is_ascii_digit())
    {
        return format!("{key}{after}");
    }
    text.to_string()
}

/// Where the next character goes on the current line.
fn column(out: &str) -> usize {
    out.len() - out.rfind('\n').map_or(0, |at| at + 1)
}

/// Write a member, with its objects on one line if they fit and have no comments, and
/// otherwise a member to a line, indented by `indent`.
fn write(out: &mut String, member: &[Piece], indent: usize) {
    let start = out.len();
    for piece in member {
        match piece {
            Piece::Text(text) => out.push_str(text),
            Piece::Comment(_) => {}
            Piece::Group(open, members) => {
                let one_line = flat(std::slice::from_ref(piece));
                match one_line {
                    Some(line) if column(out) + line.len() < WIDTH || *open != '{' => {
                        out.push_str(&line)
                    }
                    _ => {
                        let inner = " ".repeat(indent + 2);
                        out.push_str("{\n");
                        for member in members {
                            for piece in member {
                                if let Piece::Comment(comment) = piece {
                                    for line in comment.lines() {
                                        let line = line.trim();
                                        let space = if line.starts_with('*') { " " } else { "" };
                                        out.push_str(&format!("{inner}{space}{line}\n"));
                                    }
                                }
                            }
                            out.push_str(&inner);
                            let at = out.len();
                            write(out, member, indent + 2);
                            let written = tidy(&out[at..]);
                            out.truncate(at);
                            out.push_str(&written);
                            out.push_str(";\n");
                        }
                        out.push_str(&" ".repeat(indent));
                        out.push('}');
                    }
                }
            }
        }
    }
    let written = tidy(&out[start..]);
    out.truncate(start);
    out.push_str(&written);
}

/// A declaration from ts-rs (`type Name = …;`, after its doc comment), laid out for
/// reading: on one line when it fits, otherwise a union's types or an object's members a
/// line each.
fn layout(declaration: &str) -> String {
    let at = declaration
        .find("export type ")
        .expect("a type declaration");
    let (docs, declaration) = declaration.split_at(at);
    let (head, body) = declaration.split_once(" = ").expect("a type declaration");
    let body = body.trim_end().strip_suffix(';').unwrap_or(body);
    let chars: Vec<char> = body.chars().collect();
    let pieces = parse(&chars, &mut 0, None)
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();

    // The union's types: the pieces between the `|`s outside any brackets.
    let mut types: Vec<Vec<Piece>> = vec![vec![]];
    for piece in pieces {
        match piece {
            Piece::Text(text) if text.contains('|') => {
                let mut parts = text.split('|');
                if let Some(first) = parts.next() {
                    types
                        .last_mut()
                        .expect("one")
                        .push(Piece::Text(first.to_string()));
                }
                for part in parts {
                    types.push(vec![Piece::Text(part.to_string())]);
                }
            }
            piece => types.last_mut().expect("one").push(piece),
        }
    }

    let mut out = format!("{docs}{head} = ");
    let one_line = types
        .iter()
        .map(|t| flat(t))
        .collect::<Option<Vec<_>>>()
        .map(|types| types.join(" | "));
    match one_line {
        Some(line) if out.len() + line.len() < WIDTH => out.push_str(&line),
        _ if types.len() > 1 => {
            out.truncate(out.len() - 1);
            for t in &types {
                out.push_str("\n  | ");
                write(&mut out, t, 2);
            }
        }
        _ => write(&mut out, &types[0], 0),
    }
    out.push(';');
    out
}

#[test]
fn the_typescript_types_are_up_to_date() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(FILE);
    let wanted = generate();
    // Windows checkouts may have turned the line ends into \r\n.
    let current = std::fs::read_to_string(&path)
        .unwrap_or_default()
        .replace("\r\n", "\n");
    if current != wanted {
        std::fs::write(&path, &wanted).expect("writing src/api/generated.ts");
        panic!(
            "src/api/generated.ts didn't match the Rust types, so it's been brought up to date: \
             commit it, and run `npx tsc --noEmit` to see what changed for the front end."
        );
    }
}
