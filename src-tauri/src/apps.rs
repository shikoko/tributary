//! Opening a repository, or one of its files, in the editor or terminal people already use:
//! the ones installed are found where each system keeps them (app bundles on macOS, the
//! usual install folders on Windows, the PATH on Linux), and started directly with the
//! folder or file as an argument, never through a shell.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use ts_rs::TS;

use crate::error::Result;

/// An editor or terminal installed on this computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "InstalledApp")]
pub struct App {
    pub id: String,
    pub name: String,
    pub terminal: bool,
}

/// How an app is started.
#[derive(Debug, Clone)]
enum Launch {
    /// macOS: `open -a <bundle> <targets>`.
    Bundle(PathBuf),
    /// A program given the folder (and the file, for an editor) as arguments.
    Program(PathBuf),
    /// A terminal program started in the folder, with these arguments before it: the
    /// folder follows the last one (like `--working-directory=`), or, when the last one
    /// is empty, it's only the current folder.
    Terminal(PathBuf, Vec<String>),
}

struct Known {
    id: &'static str,
    name: &'static str,
    terminal: bool,
}

const EDITORS: [Known; 8] = [
    Known {
        id: "vscode",
        name: "Visual Studio Code",
        terminal: false,
    },
    Known {
        id: "cursor",
        name: "Cursor",
        terminal: false,
    },
    Known {
        id: "visualstudio",
        name: "Visual Studio",
        terminal: false,
    },
    Known {
        id: "rider",
        name: "Rider",
        terminal: false,
    },
    Known {
        id: "zed",
        name: "Zed",
        terminal: false,
    },
    Known {
        id: "sublime",
        name: "Sublime Text",
        terminal: false,
    },
    Known {
        id: "idea",
        name: "IntelliJ IDEA",
        terminal: false,
    },
    Known {
        id: "fleet",
        name: "Fleet",
        terminal: false,
    },
];

/// The folder a program is in, if `name` is on the PATH (with Windows' extensions).
fn on_path(name: &str, path: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let exts: &[&str] = if cfg!(windows) {
        &[".exe", ".cmd", ".bat"]
    } else {
        &[""]
    };
    std::env::split_paths(path?).find_map(|folder| {
        exts.iter()
            .map(|ext| folder.join(format!("{name}{ext}")))
            .find(|candidate| candidate.is_file())
    })
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from)
}

/// Where each known app is on this computer, if it is.
fn locate(id: &str) -> Option<Launch> {
    let path = std::env::var_os("PATH");
    let program = |names: &[&str]| {
        names
            .iter()
            .find_map(|name| on_path(name, path.as_deref()))
            .map(Launch::Program)
    };
    if cfg!(target_os = "macos") {
        let bundle = |names: &[&str]| {
            let home = env_path("HOME");
            names.iter().find_map(|name| {
                [
                    Some(PathBuf::from("/Applications")),
                    Some(PathBuf::from("/System/Applications/Utilities")),
                    home.as_ref().map(|home| home.join("Applications")),
                ]
                .into_iter()
                .flatten()
                .map(|folder| folder.join(format!("{name}.app")))
                .find(|app| app.is_dir())
            })
        };
        let names: &[&str] = match id {
            "vscode" => &["Visual Studio Code"],
            "cursor" => &["Cursor"],
            "rider" => &["Rider"],
            "zed" => &["Zed"],
            "sublime" => &["Sublime Text"],
            "idea" => &["IntelliJ IDEA", "IntelliJ IDEA CE"],
            "fleet" => &["Fleet"],
            "terminal" => &["Terminal"],
            "iterm" => &["iTerm"],
            "warp" => &["Warp"],
            "ghostty" => &["Ghostty"],
            _ => &[],
        };
        return bundle(names).map(Launch::Bundle);
    }
    if cfg!(windows) {
        let local = env_path("LOCALAPPDATA");
        let programs = env_path("ProgramFiles");
        let file = |candidates: Vec<Option<PathBuf>>| {
            candidates.into_iter().flatten().find(|path| path.is_file())
        };
        return match id {
            "vscode" => file(vec![
                local
                    .as_ref()
                    .map(|l| l.join("Programs/Microsoft VS Code/Code.exe")),
                programs
                    .as_ref()
                    .map(|p| p.join("Microsoft VS Code/Code.exe")),
            ])
            .map(Launch::Program),
            "cursor" => file(vec![
                local.as_ref().map(|l| l.join("Programs/cursor/Cursor.exe")),
            ])
            .map(Launch::Program),
            "zed" => file(vec![local.as_ref().map(|l| l.join("Programs/Zed/Zed.exe"))])
                .map(Launch::Program),
            "sublime" => file(vec![
                programs
                    .as_ref()
                    .map(|p| p.join("Sublime Text/sublime_text.exe")),
            ])
            .map(Launch::Program),
            "rider" => file(vec![
                local
                    .as_ref()
                    .map(|l| l.join("Programs/Rider/bin/rider64.exe")),
                programs
                    .as_ref()
                    .map(|p| p.join("JetBrains/JetBrains Rider/bin/rider64.exe")),
            ])
            .map(Launch::Program),
            "visualstudio" => visual_studio().map(Launch::Program),
            "windowsterminal" => file(vec![
                local
                    .as_ref()
                    .map(|l| l.join("Microsoft/WindowsApps/wt.exe")),
            ])
            .map(|wt| Launch::Terminal(wt, vec!["-d".into()])),
            "gitbash" => file(vec![programs.as_ref().map(|p| p.join("Git/git-bash.exe"))])
                .map(|bash| Launch::Terminal(bash, vec!["--cd=".into()])),
            "powershell" => on_path("powershell", path.as_deref())
                .map(|ps| Launch::Terminal(ps, vec!["-NoExit".into(), String::new()])),
            "cmd" => on_path("cmd", path.as_deref())
                .map(|cmd| Launch::Terminal(cmd, vec!["/K".into(), String::new()])),
            _ => None,
        };
    }
    match id {
        "vscode" => program(&["code"]),
        "cursor" => program(&["cursor"]),
        "zed" => program(&["zed", "zeditor"]),
        "sublime" => program(&["subl"]),
        "rider" => program(&["rider"]),
        "idea" => program(&["idea", "intellij-idea-community", "intellij-idea-ultimate"]),
        "fleet" => program(&["fleet"]),
        "gnome-terminal" => on_path("gnome-terminal", path.as_deref())
            .map(|t| Launch::Terminal(t, vec!["--working-directory=".into()])),
        "konsole" => on_path("konsole", path.as_deref())
            .map(|t| Launch::Terminal(t, vec!["--workdir".into()])),
        "kitty" => on_path("kitty", path.as_deref())
            .map(|t| Launch::Terminal(t, vec!["--directory".into()])),
        "alacritty" => on_path("alacritty", path.as_deref())
            .map(|t| Launch::Terminal(t, vec!["--working-directory".into()])),
        "wezterm" => on_path("wezterm", path.as_deref())
            .map(|t| Launch::Terminal(t, vec!["start".into(), "--cwd".into()])),
        "xterm" => on_path("x-terminal-emulator", path.as_deref())
            .or_else(|| on_path("xterm", path.as_deref()))
            .map(|t| Launch::Terminal(t, vec![String::new()])),
        _ => None,
    }
}

/// Visual Studio's devenv.exe, as its installer's vswhere finds the latest one.
fn visual_studio() -> Option<PathBuf> {
    let installer =
        env_path("ProgramFiles(x86)")?.join("Microsoft Visual Studio/Installer/vswhere.exe");
    let output = Command::new(installer)
        .args(["-latest", "-property", "productPath"])
        .output()
        .ok()?;
    let found = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    found.is_file().then_some(found)
}

fn terminals() -> &'static [Known] {
    if cfg!(target_os = "macos") {
        &[
            Known {
                id: "terminal",
                name: "Terminal",
                terminal: true,
            },
            Known {
                id: "iterm",
                name: "iTerm",
                terminal: true,
            },
            Known {
                id: "warp",
                name: "Warp",
                terminal: true,
            },
            Known {
                id: "ghostty",
                name: "Ghostty",
                terminal: true,
            },
        ]
    } else if cfg!(windows) {
        &[
            Known {
                id: "windowsterminal",
                name: "Windows Terminal",
                terminal: true,
            },
            Known {
                id: "powershell",
                name: "PowerShell",
                terminal: true,
            },
            Known {
                id: "gitbash",
                name: "Git Bash",
                terminal: true,
            },
            Known {
                id: "cmd",
                name: "Command Prompt",
                terminal: true,
            },
        ]
    } else {
        &[
            Known {
                id: "gnome-terminal",
                name: "GNOME Terminal",
                terminal: true,
            },
            Known {
                id: "konsole",
                name: "Konsole",
                terminal: true,
            },
            Known {
                id: "kitty",
                name: "kitty",
                terminal: true,
            },
            Known {
                id: "alacritty",
                name: "Alacritty",
                terminal: true,
            },
            Known {
                id: "wezterm",
                name: "WezTerm",
                terminal: true,
            },
            Known {
                id: "xterm",
                name: "Terminal",
                terminal: true,
            },
        ]
    }
}

/// The editors and terminals installed here, editors first.
pub fn installed_apps() -> Vec<App> {
    EDITORS
        .iter()
        .chain(terminals())
        .filter(|known| locate(known.id).is_some())
        .map(|known| App {
            id: known.id.to_owned(),
            name: known.name.to_owned(),
            terminal: known.terminal,
        })
        .collect()
}

/// Open `folder` (and `file` in it, for an editor) in app `id`.
pub fn open_in(id: &str, folder: &Path, file: Option<&Path>) -> Result<()> {
    if !folder.is_dir() {
        return Err(format!("There's no folder {}.", folder.display()).into());
    }
    let launch = locate(id).ok_or("That app isn't installed here any more.")?;
    let mut command = match launch {
        Launch::Bundle(bundle) => {
            let mut command = Command::new("open");
            command.arg("-a").arg(bundle).arg(folder);
            if let Some(file) = file {
                command.arg(file);
            }
            command
        }
        Launch::Program(program) => {
            let mut command = Command::new(program);
            command.arg(folder);
            if let Some(file) = file {
                command.arg(file);
            }
            command
        }
        Launch::Terminal(program, args) => {
            let mut command = Command::new(program);
            let (last, before) = args
                .split_last()
                .map_or((None, &[][..]), |(last, before)| (Some(last), before));
            command.args(before);
            match last {
                // "--working-directory=": the folder joined on; "-d": the folder after it.
                Some(flag) if flag.ends_with('=') => {
                    let mut joined = std::ffi::OsString::from(flag);
                    joined.push(folder.as_os_str());
                    command.arg(joined);
                }
                Some(flag) if !flag.is_empty() => {
                    command.arg(flag).arg(folder);
                }
                _ => {}
            }
            command.current_dir(folder);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                // A console of its own, for PowerShell and the Command Prompt.
                const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
                command.creation_flags(CREATE_NEW_CONSOLE);
            }
            command
        }
    };
    command
        .current_dir(folder)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Couldn't open it: {e}").into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_programs_on_the_path() {
        let dir = std::env::temp_dir().join(format!("tributary-apps-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let name = if cfg!(windows) {
            "fake-editor.exe"
        } else {
            "fake-editor"
        };
        std::fs::write(dir.join(name), "").unwrap();
        let path = std::env::join_paths([dir.clone()]).unwrap();
        assert_eq!(on_path("fake-editor", Some(&path)), Some(dir.join(name)));
        assert_eq!(on_path("missing", Some(&path)), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_a_folder_that_isnt_there() {
        assert!(open_in("vscode", Path::new("/no/such/folder"), None).is_err());
    }
}
