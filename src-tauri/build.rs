fn main() {
    // Tauri rebuilds when its configuration changes, but the program also carries the app's
    // icon (on Windows, in the .exe): rebuild when the icons change too.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
