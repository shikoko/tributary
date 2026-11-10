// The installers the setup carries: Tauri's NSIS installers for the app, one installing just
// for the person running it (TRIBUTARY_INSTALLER) and one for everyone on the PC
// (TRIBUTARY_INSTALLER_ALL). The release build sets both. Without them, the setup builds but
// has nothing to install, which is enough for working on its window.
fn main() {
    println!("cargo::rerun-if-env-changed=TRIBUTARY_VERSION");
    for (variable, cfg) in [
        ("TRIBUTARY_INSTALLER", "has_installer"),
        ("TRIBUTARY_INSTALLER_ALL", "has_installer_all"),
    ] {
        println!("cargo::rerun-if-env-changed={variable}");
        let Some(path) = std::env::var_os(variable) else {
            continue;
        };
        let path = std::path::PathBuf::from(path);
        if path.is_file() {
            println!("cargo::rerun-if-changed={}", path.display());
            println!("cargo::rustc-cfg={cfg}");
        } else {
            println!(
                "cargo::warning={variable} doesn't name a file: {}",
                path.display()
            );
        }
    }
    tauri_build::build()
}
