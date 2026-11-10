//! Unreal Engine's one-file-per-actor levels (World Partition): each actor placed in a
//! level is saved in its own file under `__ExternalActors__`, named by a hash, like
//! `Content/__ExternalActors__/Maps/Tavern/7/K2/0Q1UKG5YNDRBWFN1VO0RYP.uasset`. Lists of
//! files would be lists of hashes; this finds what each one is: the actor's name in the
//! editor (its label), its class and its level.
//!
//! The label and class come from the asset registry data the editor saves in each package
//! (the same tags its own tools read): an object's path and class, then its tags, each a
//! key and a value, as Unreal strings (a length, then the text and a NUL; a negative length
//! means UTF-16).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use crate::error::{Error, Result};

/// What an actor's file holds.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorName {
    /// Its name in the editor's outliner, like "SM_RackShelf_215".
    pub label: Option<String>,
    /// Its class, short: "StaticMeshActor", or a Blueprint's name, like "BP_Door".
    pub class: Option<String>,
    /// The level it's in, like "Maps/Tavern".
    pub level: Option<String>,
}

const FOLDERS: [&str; 2] = ["__ExternalActors__/", "__ExternalObjects__/"];
/// The tags are near the start: a file's first 128 KB is plenty.
const READ_AT_MOST: u64 = 128 * 1024;

/// Whether a path is an actor (or object) saved in its own file.
pub fn is_external_actor(path: &str) -> bool {
    path.ends_with(".uasset")
        && FOLDERS
            .iter()
            .any(|folder| path.starts_with(folder) || path.contains(&format!("/{folder}")))
}

/// The level an actor's file belongs to, from its path: what's between the folder and the
/// two hash folders, like "Maps/Tavern".
pub fn level_of(path: &str) -> Option<String> {
    let (_, rest) = FOLDERS.iter().find_map(|folder| path.split_once(folder))?;
    let mut parts: Vec<&str> = rest.split('/').collect();
    parts.pop(); // the file
    for _ in 0..2 {
        let hashed = parts.last().is_some_and(|part| {
            (1..=2).contains(&part.len())
                && part
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        });
        if hashed && parts.len() > 1 {
            parts.pop();
        }
    }
    let level = parts.join("/");
    (!level.is_empty()).then_some(level)
}

/// An Unreal string at `at`: its text, and where it ends.
fn read_string(bytes: &[u8], at: usize) -> Option<(String, usize)> {
    let length = i32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?);
    let start = at + 4;
    let (text, end) = if length > 0 {
        let length = usize::try_from(length).ok()?;
        if length > 2048 {
            return None;
        }
        let raw = bytes.get(start..start + length)?;
        let (&nul, text) = raw.split_last()?;
        if nul != 0 || text.contains(&0) {
            return None;
        }
        (String::from_utf8_lossy(text).into_owned(), start + length)
    } else if length < 0 {
        let units = usize::try_from(length.unsigned_abs()).ok()?;
        if units > 2048 {
            return None;
        }
        let raw = bytes.get(start..start + units * 2)?;
        let mut words: Vec<u16> = raw
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&pair| u16::from_le_bytes(pair))
            .collect();
        if words.pop() != Some(0) || words.contains(&0) {
            return None;
        }
        (String::from_utf16(&words).ok()?, start + units * 2)
    } else {
        return None;
    };
    // Names and paths: no control characters.
    (!text.chars().any(char::is_control)).then_some((text, end))
}

/// The class's short name: "/Script/Engine.StaticMeshActor" is "StaticMeshActor", and a
/// Blueprint's "/Game/Props/BP_Door.BP_Door_C" is "BP_Door".
fn short_class(path: &str) -> String {
    let name = path.rsplit(['.', '/']).next().unwrap_or(path);
    name.strip_suffix("_C").unwrap_or(name).to_owned()
}

/// The label and class saved in an actor's package (`bytes`, or its start).
pub fn read_actor(bytes: &[u8]) -> (Option<String>, Option<String>) {
    const KEY: &[u8] = b"\x0b\x00\x00\x00ActorLabel\x00";
    // The name table lists "ActorLabel" too, followed by a hash rather than a string: the
    // tag is the occurrence followed by a string, the last one in the file.
    let mut end = bytes.len();
    while let Some(at) = find_last(&bytes[..end], KEY) {
        end = at;
        let Some((label, mut next)) = read_string(bytes, at + KEY.len()) else {
            continue;
        };
        // The tags after it, for the class (ActorMetaDataClass), or else the class saved
        // before the tags.
        let mut class = None;
        for _ in 0..16 {
            let Some((key, after_key)) = read_string(bytes, next) else {
                break;
            };
            let Some((value, after_value)) = read_string(bytes, after_key) else {
                break;
            };
            if key == "ActorMetaDataClass" {
                class = Some(value);
                break;
            }
            next = after_value;
        }
        let class = class.or_else(|| class_before(bytes, at));
        let label = Some(label).filter(|label| !label.is_empty());
        return (label, class.map(|class| short_class(&class)));
    }
    (None, None)
}

/// The object's class, saved just before its tags (and their count), when the label is
/// the first tag: read back from where the tags start.
fn class_before(bytes: &[u8], tags: usize) -> Option<String> {
    let class_end = tags.checked_sub(4)?;
    // The string's length is what comes before it: try each.
    (2..=512).find_map(|length| {
        let start = class_end.checked_sub(length)?.checked_sub(4)?;
        let (class, end) = read_string(bytes, start)?;
        (end == class_end && class.starts_with('/')).then_some(class)
    })
}

fn find_last(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .rposition(|window| window == needle)
}

/// Labels already read, by the file's content (a blob id) or path, size and time.
/// An actor's label and class, as read from its file.
type LabelAndClass = (Option<String>, Option<String>);

static READ: Mutex<Option<HashMap<String, LabelAndClass>>> = Mutex::new(None);

fn remembered(
    key: &str,
    read: impl FnOnce() -> Option<Vec<u8>>,
) -> (Option<String>, Option<String>) {
    if let Ok(cache) = READ.lock()
        && let Some(found) = cache.as_ref().and_then(|cache| cache.get(key))
    {
        return found.clone();
    }
    let found = read().map(|bytes| read_actor(&bytes)).unwrap_or_default();
    if let Ok(mut cache) = READ.lock() {
        let cache = cache.get_or_insert_with(HashMap::new);
        if cache.len() > 50_000 {
            cache.clear();
        }
        cache.insert(key.to_owned(), found.clone());
    }
    found
}

/// A file's start, from disk.
fn read_start(path: &Path) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(READ_AT_MOST)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(bytes)
}

/// A Git LFS pointer's object id.
fn pointer_oid(bytes: &[u8]) -> Option<String> {
    if bytes.len() > 1024 || !bytes.starts_with(b"version https://git-lfs") {
        return None;
    }
    String::from_utf8_lossy(bytes)
        .lines()
        .find_map(|line| line.strip_prefix("oid sha256:"))
        .map(|oid| oid.trim().to_owned())
        .filter(|oid| oid.len() == 64 && oid.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// Where Git LFS keeps an object it has downloaded.
fn lfs_object(common_dir: &Path, oid: &str) -> PathBuf {
    common_dir
        .join("lfs")
        .join("objects")
        .join(&oid[..2])
        .join(&oid[2..4])
        .join(oid)
}

/// What the actors in `files` are, at commit `at` (or in the working tree), where they
/// can be read: files not there are read at `fallback` (or the first parent; or for the
/// working tree, the checked-out commit), like a deleted actor.
pub fn actor_names(
    path: &Path,
    at: Option<&str>,
    fallback: Option<&str>,
    files: &[String],
) -> Result<HashMap<String, ActorName>> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo.workdir().map(Path::to_path_buf);
    let common = repo.common_dir().to_path_buf();
    let commit = |id: &str| {
        gix::ObjectId::from_hex(id.as_bytes())
            .ok()
            .and_then(|id| repo.find_commit(id).ok())
    };
    fn tree_of(commit: Option<gix::Commit<'_>>) -> Option<gix::Tree<'_>> {
        commit.and_then(|commit| commit.tree().ok())
    }
    let (tree, before) = match at {
        Some(at) => {
            let at = commit(at);
            let before = match fallback {
                Some(fallback) => commit(fallback),
                None => at
                    .as_ref()
                    .and_then(|at| at.parent_ids().next())
                    .and_then(|parent| repo.find_commit(parent).ok()),
            };
            (tree_of(at), tree_of(before))
        }
        None => {
            let head = match fallback {
                Some(fallback) => commit(fallback),
                None => repo.head_commit().ok(),
            };
            (None, tree_of(head))
        }
    };
    // A blob's content, or for a Git LFS pointer, the downloaded file's start (or, when it
    // isn't downloaded, the working tree's copy).
    let from_tree =
        |tree: &gix::Tree<'_>, file: &str| -> Option<(Option<String>, Option<String>)> {
            let entry = tree.lookup_entry_by_path(file).ok()??;
            let id = entry.object_id().to_string();
            let found = remembered(&id, || {
                let blob = entry.object().ok()?;
                match pointer_oid(&blob.data) {
                    Some(oid) => read_start(&lfs_object(&common, &oid))
                        .or_else(|| workdir.as_ref().and_then(|dir| read_start(&dir.join(file)))),
                    None => Some(blob.data.clone()),
                }
            });
            Some(found)
        };
    let from_disk = |file: &str| -> Option<(Option<String>, Option<String>)> {
        let full = workdir.as_ref()?.join(file);
        let metadata = std::fs::metadata(&full).ok()?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |time| time.as_nanos());
        let key = format!("{}|{}|{modified}", full.display(), metadata.len());
        Some(remembered(&key, || {
            let bytes = read_start(&full)?;
            match pointer_oid(&bytes) {
                Some(oid) => read_start(&lfs_object(&common, &oid)),
                None => Some(bytes),
            }
        }))
    };
    let mut names = HashMap::new();
    for file in files.iter().filter(|file| is_external_actor(file)) {
        let found = match &tree {
            Some(tree) => from_tree(tree, file),
            None if at.is_none() => from_disk(file),
            None => None,
        }
        .filter(|(label, class)| label.is_some() || class.is_some())
        .or_else(|| before.as_ref().and_then(|tree| from_tree(tree, file)));
        let (label, class) = found.unwrap_or_default();
        names.insert(
            file.clone(),
            ActorName {
                label,
                class,
                level: level_of(file),
            },
        );
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An Unreal string.
    fn string(text: &str) -> Vec<u8> {
        if text.is_ascii() {
            let mut out = ((text.len() + 1) as i32).to_le_bytes().to_vec();
            out.extend(text.as_bytes());
            out.push(0);
            out
        } else {
            let words: Vec<u16> = text.encode_utf16().chain([0]).collect();
            let mut out = (-(words.len() as i32)).to_le_bytes().to_vec();
            out.extend(words.iter().flat_map(|word| word.to_le_bytes()));
            out
        }
    }

    /// A package's asset registry data: the name table first (with "ActorLabel" and a hash
    /// after it), then the object, its class and its tags.
    fn package(class: &str, tags: &[(&str, &str)]) -> Vec<u8> {
        let mut out = vec![0xC1, 0x83, 0x2A, 0x9E];
        out.extend(string("ActorLabel"));
        out.extend([0x9f, 0x8b, 0xf8, 0x12]);
        out.extend(string("ArrayProperty"));
        out.extend([1, 2, 3, 4, 0, 0, 0, 0, 1, 0, 0, 0]);
        out.extend(string("StaticMeshActor_UAID_0123456789"));
        out.extend(string(class));
        out.extend((tags.len() as i32).to_le_bytes());
        for (key, value) in tags {
            out.extend(string(key));
            out.extend(string(value));
        }
        out.extend([0; 16]);
        out
    }

    #[test]
    fn reads_the_label_and_class() {
        let bytes = package(
            "/Script/Engine.StaticMeshActor",
            &[
                ("ActorLabel", "SM_RackShelf_215"),
                ("ActorMetaData", "BAAAAIHVfWmr"),
                ("ActorMetaDataClass", "/Script/Engine.StaticMeshActor"),
            ],
        );
        assert_eq!(
            read_actor(&bytes),
            (
                Some("SM_RackShelf_215".to_owned()),
                Some("StaticMeshActor".to_owned())
            )
        );
    }

    #[test]
    fn reads_the_class_before_the_tags_and_names_in_any_script() {
        let bytes = package(
            "/Game/Props/BP_Door.BP_Door_C",
            &[("ActorLabel", "Tür zum Keller 🚪")],
        );
        assert_eq!(
            read_actor(&bytes),
            (
                Some("Tür zum Keller 🚪".to_owned()),
                Some("BP_Door".to_owned())
            )
        );
    }

    #[test]
    fn finds_nothing_in_other_files() {
        assert_eq!(read_actor(b"not a package"), (None, None));
        let mut cut = package("/Script/Engine.StaticMeshActor", &[("ActorLabel", "Rock")]);
        cut.truncate(cut.len() - 24);
        assert_eq!(read_actor(&cut).0, None);
    }

    #[test]
    fn knows_actor_files_and_their_levels() {
        let file = "Content/__ExternalActors__/Maps/Section/CAreaObjects/1/W2/SBRSU0GDZKLN1PJWC06TB3.uasset";
        assert!(is_external_actor(file));
        assert_eq!(level_of(file).as_deref(), Some("Maps/Section/CAreaObjects"));
        let plugin = "Plugins/Ocean/Content/__ExternalActors__/Maps/OpenWorld/Horizon_Map/3/FX/NNDQL2S2DOVE0M2RDSCQLI.uasset";
        assert_eq!(
            level_of(plugin).as_deref(),
            Some("Maps/OpenWorld/Horizon_Map")
        );
        assert!(!is_external_actor("Content/Maps/Tavern.umap"));
        assert!(!is_external_actor(
            "Content/__ExternalActors__/Maps/Tavern/notes.txt"
        ));
    }
}
