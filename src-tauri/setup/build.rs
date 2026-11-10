// The installer the setup carries: Tauri's NSIS installer for the app, from the path in
// TRIBUTARY_INSTALLER (the release build sets it). Without it, the setup builds but has
// nothing to install, which is enough for working on its window.
fn main() {
    println!("cargo::rerun-if-env-changed=TRIBUTARY_INSTALLER");
    println!("cargo::rerun-if-env-changed=TRIBUTARY_VERSION");
    if let Some(path) = std::env::var_os("TRIBUTARY_INSTALLER") {
        let path = std::path::PathBuf::from(path);
        if path.is_file() {
            println!("cargo::rerun-if-changed={}", path.display());
            println!("cargo::rustc-cfg=has_installer");
        } else {
            println!(
                "cargo::warning=TRIBUTARY_INSTALLER doesn't name a file: {}",
                path.display()
            );
        }
    }
    tauri_build::build()
}
