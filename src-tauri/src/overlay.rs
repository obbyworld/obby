//! Native treatment for the screen-region windows.
//!
//! A picker that covers the desktop is not an ordinary window: a tiling window
//! manager must leave it alone, and it has to sit above everything rather than
//! join the layout. Neither is expressible through Tauri's window builder, so
//! each platform gets what it needs here.

use tauri::Runtime;

/// `label` names the window to treat: the caller is the main window setting up
/// the overlays, never the overlay itself. A higher `level` sits over a lower
/// one, which is how the controls stay above the dimmed picker rather than
/// becoming its sibling at the same height.
#[tauri::command]
pub fn prepare_region_overlay<R: Runtime>(
    app: tauri::AppHandle<R>,
    label: String,
    level: i32,
) -> Result<(), String> {
    use tauri::Manager;

    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("no window named {label}"))?;
    apply(&window.as_ref().window(), level)
}

#[cfg(target_os = "macos")]
fn apply<R: Runtime>(window: &tauri::Window<R>, level: i32) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

    let ptr = window.ns_window().map_err(|e| e.to_string())? as *mut NSWindow;
    if ptr.is_null() {
        return Err("no native window".into());
    }
    // Safety: Tauri hands us the live NSWindow for this label, and everything
    // below runs on the main thread where AppKit requires it.
    let ns_window: Retained<NSWindow> = unsafe { Retained::retain(ptr) }.ok_or("window gone")?;

    // Above normal windows and above full-screen ones. Screen capture and
    // screenshot tools sit around this height for the same reason.
    ns_window.setLevel(NS_SCREEN_SAVER_WINDOW_LEVEL + level as isize);
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    ns_window.setHidesOnDeactivate(false);
    Ok(())
}

/// NSScreenSaverWindowLevel. AppKit exposes the levels as plain integers.
#[cfg(target_os = "macos")]
const NS_SCREEN_SAVER_WINDOW_LEVEL: isize = 1000;

#[cfg(target_os = "linux")]
fn apply<R: Runtime>(window: &tauri::Window<R>, level: i32) -> Result<(), String> {
    use gtk::prelude::*;

    let gtk_window = window.gtk_window().map_err(|e| e.to_string())?;
    // A utility window is left floating by i3, sway and bspwm instead of being
    // given a tile of its own.
    gtk_window.set_type_hint(gdk::WindowTypeHint::Utility);
    gtk_window.set_keep_above(level >= 0);
    gtk_window.stick();
    gtk_window.set_skip_taskbar_hint(true);
    gtk_window.set_skip_pager_hint(true);
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn apply<R: Runtime>(_window: &tauri::Window<R>, _level: i32) -> Result<(), String> {
    Ok(())
}
