//! Spelling in the window's text fields. The webviews on Windows and macOS check it by
//! themselves; WebKitGTK, on Linux, only once it's asked to.

/// Turns spell checking on where the webview leaves it off, in the computer's language.
#[cfg(target_os = "linux")]
pub fn turn_on(app: &tauri::AppHandle) {
    use tauri::Manager;
    use webkit2gtk::{WebContextExt, WebViewExt};
    for window in app.webview_windows().values() {
        let _ = window.with_webview(|webview| {
            if let Some(context) = webview.inner().context() {
                context.set_spell_checking_enabled(true);
                // No languages named: WebKitGTK uses the computer's, or else the first
                // dictionary it finds.
                context.set_spell_checking_languages(&[]);
            }
        });
    }
}

/// Nothing to do: the webview checks spelling by itself.
#[cfg(not(target_os = "linux"))]
pub fn turn_on(_app: &tauri::AppHandle) {}
