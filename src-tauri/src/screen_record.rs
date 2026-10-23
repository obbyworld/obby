//! Recording a rectangle of the desktop, natively.
//!
//! The browser's screen capture always asks the person to pick a screen, which
//! is the wrong question when they have already drawn a rectangle. Each system
//! ships something that records a given rect directly, so that is what we
//! drive: macOS has `screencapture`, and elsewhere it is ffmpeg, or
//! wf-recorder on a wlroots compositor.

use base64::Engine;
use std::path::PathBuf;
#[cfg(not(target_os = "windows"))]
use std::process::Child;
use std::process::Command;
use std::sync::Mutex;

/// The rectangle to record, in desktop points with the origin at the top left
/// of the primary screen.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// `finished` holds the one file the webview is allowed to ask for, so naming
/// a path from JavaScript can never reach anything else on disk.
#[derive(Default)]
pub struct RecorderState {
    running: Mutex<Option<Recording>>,
    finished: Mutex<Option<PathBuf>>,
}

pub struct Recording {
    backend: Backend,
    path: PathBuf,
}

/// Where the pixels come from. Most systems ship a recorder we can drive as a
/// command; Windows ships the pieces as an API instead.
enum Backend {
    #[cfg(not(target_os = "windows"))]
    Process(Child),
    #[cfg(target_os = "windows")]
    Native(crate::screen_record_windows::WindowsRecording),
}

/// The program and arguments that record `rect` into `path`. Split out so the
/// per-system flags can be checked without recording anything.
#[cfg(not(target_os = "windows"))]
pub fn record_command(rect: Rect, path: &str, audio: bool) -> (String, Vec<String>) {
    #[cfg(target_os = "macos")]
    {
        let mut args = vec![
            "-v".into(),
            // No shutter sound, and no interactive selection: the rectangle is
            // already chosen.
            "-x".into(),
            format!("-R{},{},{},{}", rect.x, rect.y, rect.width, rect.height),
        ];
        if audio {
            args.push("-g".into());
        }
        args.push(path.into());
        ("screencapture".into(), args)
    }

    #[cfg(not(target_os = "macos"))]
    {
        #[cfg(target_os = "linux")]
        if wayland_session() && has_binary("wf-recorder") {
            let mut args = vec![
                "-g".into(),
                format!("{},{} {}x{}", rect.x, rect.y, rect.width, rect.height),
                "-f".into(),
                path.into(),
            ];
            if audio {
                args.push("--audio".into());
            }
            return ("wf-recorder".into(), args);
        }
        let mut args = vec![
            "-f".into(),
            "x11grab".into(),
            "-framerate".into(),
            "30".into(),
            "-video_size".into(),
            format!("{}x{}", rect.width, rect.height),
            "-i".into(),
            format!(":0.0+{},{}", rect.x, rect.y),
        ];
        if audio {
            args.extend(["-f".into(), "pulse".into(), "-i".into(), "default".into()]);
        }
        args.extend([
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "ultrafast".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-y".into(),
            path.into(),
        ]);
        ("ffmpeg".into(), args)
    }
}

/// What the recorder itself writes. macOS records QuickTime whatever the file
/// is called, so that is remuxed to MP4 afterwards.
pub fn capture_extension() -> &'static str {
    if cfg!(target_os = "macos") {
        "mov"
    } else {
        "mp4"
    }
}

/// How a finished recording is turned into MP4, or None when the file already
/// is one. Nothing is re-encoded: the same video and audio are put into the
/// container every client can play.
pub fn remux_command(source: &str, target: &str) -> Option<(String, Vec<String>)> {
    if capture_extension() == "mp4" {
        return None;
    }
    // Shipped with macOS, so every Mac takes the same path whether or not
    // someone happens to have installed ffmpeg.
    if has_binary("avconvert") {
        return Some((
            "avconvert".into(),
            vec![
                "--source".into(),
                source.into(),
                "--output".into(),
                target.into(),
                "--preset".into(),
                "PresetPassthrough".into(),
            ],
        ));
    }
    if has_binary("ffmpeg") {
        return Some((
            "ffmpeg".into(),
            vec![
                "-v".into(),
                "error".into(),
                "-i".into(),
                source.into(),
                "-c".into(),
                "copy".into(),
                // Puts the index first so a player can start before the whole
                // file has arrived.
                "-movflags".into(),
                "+faststart".into(),
                "-y".into(),
                target.into(),
            ],
        ));
    }
    None
}

pub fn has_binary(name: &str) -> bool {
    Command::new("which")
        .arg(name)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// A session running through XWayland sets WAYLAND_DISPLAY too, and there it
/// is X11 that answers, so GDK_BACKEND has the last word.
#[cfg(target_os = "linux")]
fn wayland_session() -> bool {
    if std::env::var("GDK_BACKEND")
        .map(|v| v == "x11")
        .unwrap_or(false)
    {
        return false;
    }
    std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|v| v == "wayland")
            .unwrap_or(false)
}

/// True when this system can both place the picker over the desktop and record
/// the rectangle it returns. Windows records through an API that is part of the
/// system, so there is nothing there that could be missing.
#[tauri::command]
pub fn region_recording_supported() -> bool {
    if cfg!(mobile) {
        return false;
    }
    if cfg!(target_os = "windows") {
        return true;
    }
    if cfg!(target_os = "macos") {
        return has_binary("screencapture");
    }
    #[cfg(target_os = "linux")]
    {
        // Wayland gives a window no say in where it goes, so the picker cannot
        // be put over a chosen screen at all.
        if wayland_session() {
            return false;
        }
    }
    has_binary("ffmpeg")
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// True when this app may record the screen. On macOS `screencapture` records
/// as us, so we ask before drawing anything; the system shows its own prompt
/// only the first time and answers false silently after that.
#[tauri::command]
pub fn screen_recording_allowed() -> bool {
    #[cfg(target_os = "macos")]
    // SAFETY: both calls take no arguments and only read or request the
    // Screen Recording permission of this process.
    unsafe {
        CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
    }
    #[cfg(not(target_os = "macos"))]
    true
}

#[tauri::command]
pub fn start_region_recording(
    state: tauri::State<'_, RecorderState>,
    rect: Rect,
    crop: Rect,
    audio: bool,
    monitor: Option<usize>,
) -> Result<String, String> {
    let mut slot = state.running.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Err("a recording is already running".into());
    }
    if rect.width == 0 || rect.height == 0 {
        return Err("the chosen area is empty".into());
    }
    discard_finished(&state)?;

    let path = std::env::temp_dir().join(format!(
        "obby-screen-{}.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default(),
        capture_extension()
    ));
    let path_str = path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    let backend = {
        let _ = (audio, rect);
        Backend::Native(crate::screen_record_windows::start(
            crop,
            &path_str,
            monitor.unwrap_or(0),
        )?)
    };
    #[cfg(not(target_os = "windows"))]
    let backend = {
        let _ = (monitor, crop);
        let (program, args) = record_command(rect, &path_str, audio);
        Backend::Process(
            Command::new(&program)
                .args(&args)
                .spawn()
                .map_err(|e| format!("could not start {program}: {e}"))?,
        )
    };

    *slot = Some(Recording { backend, path });
    Ok(path_str)
}

/// Ends the recording and returns the finished file. The recorder is asked to
/// stop rather than killed, since only a clean stop writes the index a player
/// needs to open the file at all.
#[tauri::command]
pub fn stop_region_recording(state: tauri::State<'_, RecorderState>) -> Result<String, String> {
    let mut slot = state.running.lock().map_err(|e| e.to_string())?;
    let Some(recording) = slot.take() else {
        return Err("nothing is recording".into());
    };
    finish(recording.backend)?;
    if !recording.path.exists() {
        return Err("the recorder wrote no file".into());
    }
    let ready = to_mp4(&recording.path);
    *state.finished.lock().map_err(|e| e.to_string())? = Some(PathBuf::from(&ready));
    Ok(ready)
}

/// Remuxes into MP4 when this system records something else, keeping the
/// original only if there is nothing here that can do it.
fn to_mp4(source: &std::path::Path) -> String {
    let source_str = source.to_string_lossy().to_string();
    let target = source.with_extension("mp4");
    let target_str = target.to_string_lossy().to_string();
    let Some((program, args)) = remux_command(&source_str, &target_str) else {
        return source_str;
    };
    let ran = Command::new(&program)
        .args(&args)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if ran && target.exists() {
        let _ = std::fs::remove_file(source);
        return target_str;
    }
    source_str
}

#[tauri::command]
pub fn cancel_region_recording(state: tauri::State<'_, RecorderState>) -> Result<(), String> {
    let mut slot = state.running.lock().map_err(|e| e.to_string())?;
    if let Some(recording) = slot.take() {
        let _ = finish(recording.backend);
        let _ = std::fs::remove_file(&recording.path);
    }
    discard_finished(&state)
}

/// Takes the waiting recording off disk. A recording never outlives the message
/// it was made for, so an abandoned one goes before the next one starts.
fn discard_finished(state: &tauri::State<'_, RecorderState>) -> Result<(), String> {
    if let Some(path) = state.finished.lock().map_err(|e| e.to_string())?.take() {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

/// Hands the finished recording to the webview and takes it off disk. Base64
/// rather than raw bytes, because how a byte response reaches JavaScript depends
/// on which transport the webview negotiated, and a file that arrives subtly
/// reshaped is one the filehost refuses without saying why.
#[tauri::command]
pub fn take_recording(state: tauri::State<'_, RecorderState>) -> Result<String, String> {
    let path = state
        .finished
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("no recording is waiting")?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&path);
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Ends a recording so the file is complete, whichever way it was made.
fn finish(backend: Backend) -> Result<(), String> {
    match backend {
        #[cfg(not(target_os = "windows"))]
        Backend::Process(mut child) => {
            interrupt(&child);
            let _ = child.wait();
            Ok(())
        }
        #[cfg(target_os = "windows")]
        Backend::Native(recording) => recording.stop(),
    }
}

#[cfg(unix)]
fn interrupt(child: &Child) {
    // SIGINT is what tells screencapture, ffmpeg and wf-recorder alike to
    // finish the file they are writing.
    unsafe {
        libc::kill(child.id() as libc::pid_t, libc::SIGINT);
    }
}

#[cfg(all(test, not(target_os = "windows")))]
mod tests {
    use super::*;

    fn rect() -> Rect {
        Rect {
            x: 12,
            y: 34,
            width: 640,
            height: 480,
        }
    }

    #[test]
    fn records_the_given_rectangle() {
        let (program, args) = record_command(rect(), "/tmp/out.mov", false);
        let joined = args.join(" ");
        assert!(!program.is_empty());
        if cfg!(target_os = "macos") {
            assert_eq!(program, "screencapture");
            // The rect is passed through as-is: no picker, no whole screen.
            assert!(joined.contains("-R12,34,640,480"), "{joined}");
            assert!(joined.contains("-v"), "{joined}");
        } else {
            assert!(joined.contains("640x480"), "{joined}");
        }
        assert!(joined.contains("/tmp/out.mov"), "{joined}");
    }

    #[test]
    fn asks_for_audio_only_when_wanted() {
        let (_, quiet) = record_command(rect(), "/tmp/out.mov", false);
        let (_, loud) = record_command(rect(), "/tmp/out.mov", true);
        assert!(loud.len() > quiet.len());
    }

    // The filehost identifies a file by its first bytes, so a QuickTime header
    // has to survive the trip to the webview exactly.
    #[test]
    fn base64_round_trips_the_bytes_a_recording_starts_with() {
        let header = b"\x00\x00\x00\x14ftypqt  ";
        let encoded = base64::engine::general_purpose::STANDARD.encode(header);
        assert_eq!(encoded, "AAAAFGZ0eXBxdCAg");
    }

    // Sending QuickTime would mean sending something half the clients reading
    // the channel cannot play, so a recording leaves as MP4.
    #[test]
    fn a_quicktime_recording_is_remuxed_to_mp4() {
        let command = remux_command("/tmp/in.mov", "/tmp/out.mp4");
        if capture_extension() == "mp4" {
            assert!(command.is_none());
            return;
        }
        let (program, args) = command.expect("a mac has avconvert even without ffmpeg");
        let joined = args.join(" ");
        assert!(joined.contains("/tmp/out.mp4"), "{joined}");
        assert!(joined.contains("/tmp/in.mov"), "{joined}");
        // Whichever tool it picks, it must not re-encode.
        let passthrough = joined.contains("-c copy") || joined.contains("PresetPassthrough");
        assert!(passthrough, "{program} {joined}");
    }
}
