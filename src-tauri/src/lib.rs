use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

mod socket;

use socket::{connect, disconnect, listen, send, SocketState};

#[tauri::command]
async fn download_image(app: tauri::AppHandle, url: String) -> Result<String, String> {
    download_image_impl(app, url).await
}

fn extract_filename(url: &str) -> String {
    url.split('/')
        .next_back()
        .and_then(|s| s.split('?').next())
        .filter(|s| !s.is_empty())
        .unwrap_or("image")
        .to_string()
}

#[cfg(desktop)]
async fn download_image_impl(_app: tauri::AppHandle, url: String) -> Result<String, String> {
    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let filename = extract_filename(&url);
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    if let Some(file) = rfd::AsyncFileDialog::new()
        .set_file_name(&filename)
        .save_file()
        .await
    {
        std::fs::write(file.path(), &bytes).map_err(|e| e.to_string())?;
    }
    Ok(String::new())
}

#[cfg(target_os = "ios")]
async fn download_image_impl(_app: tauri::AppHandle, url: String) -> Result<String, String> {
    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let filename = extract_filename(&url);
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    // Write to the temp directory; iOS cleans this up automatically.
    let tmp_path = std::env::temp_dir().join(&filename);
    std::fs::write(&tmp_path, &bytes).map_err(|e| e.to_string())?;

    if let Some(path_str) = tmp_path.to_str() {
        tauri_plugin_share_sheet::share_file(path_str);
    }

    Ok(String::new())
}

#[cfg(target_os = "android")]
async fn download_image_impl(app: tauri::AppHandle, url: String) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let filename = extract_filename(&url);
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    if bytes.is_empty() {
        return Err("Downloaded file is empty".to_string());
    }

    // Show Android save-file picker (Intent.ACTION_CREATE_DOCUMENT).
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();
    app.dialog()
        .file()
        .set_file_name(&filename)
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    if let Ok(Some(dest)) = rx.await {
        // Convert bytes::Bytes to Vec so it can be moved into spawn_blocking.
        let bytes_vec = bytes.to_vec();
        match dest {
            tauri_plugin_dialog::FilePath::Path(path) => {
                // Rare on Android but handle it — run on a blocking thread.
                tokio::task::spawn_blocking(move || {
                    std::fs::write(&path, &bytes_vec).map_err(|e| e.to_string())
                })
                .await
                .map_err(|e| format!("Thread join error: {e}"))??;
            }
            tauri_plugin_dialog::FilePath::Url(uri) => {
                // Android always returns a content:// URI — write via ContentResolver.
                // Use spawn_blocking so JNI work runs on a thread that is safe to
                // attach/detach; we must NOT attach/detach Tauri's own async threads
                // because Tauri needs them to remain JVM-attached to route the result
                // back to JavaScript via WebView.evaluateJavascript().
                let uri_str = uri.to_string();
                tokio::task::spawn_blocking(move || {
                    write_bytes_to_content_uri(&bytes_vec, &uri_str)
                })
                .await
                .map_err(|e| format!("Thread join error: {e}"))??;
            }
        }
    }
    Ok(String::new())
}

#[cfg(target_os = "android")]
fn write_bytes_to_content_uri(bytes: &[u8], uri_str: &str) -> Result<(), String> {
    use jni::{
        objects::{JObject, JValue},
        JavaVM,
    };

    let ctx = ndk_context::android_context();
    // SAFETY: pointers come from the Android runtime and are valid for the app lifetime.
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    // attach_current_thread is idempotent: if the thread is already attached it just
    // returns the existing env and the guard won't detach on drop.
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    let resolver = env
        .call_method(
            &activity,
            "getContentResolver",
            "()Landroid/content/ContentResolver;",
            &[],
        )
        .map_err(|e| e.to_string())?
        .l()
        .map_err(|e| e.to_string())?;

    let j_uri_str = env.new_string(uri_str).map_err(|e| e.to_string())?;
    let uri_obj = env
        .call_static_method(
            "android/net/Uri",
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[JValue::Object(&*j_uri_str)],
        )
        .map_err(|e| e.to_string())?
        .l()
        .map_err(|e| e.to_string())?;

    // Use "wt" mode (write + truncate) — the single-arg overload defaults to "w" which
    // does not work with all Android storage providers. "wt" is explicit and reliable.
    let mode = env.new_string("wt").map_err(|e| e.to_string())?;
    let stream = env
        .call_method(
            &resolver,
            "openOutputStream",
            "(Landroid/net/Uri;Ljava/lang/String;)Ljava/io/OutputStream;",
            &[JValue::Object(&uri_obj), JValue::Object(&*mode)],
        )
        .map_err(|e| e.to_string())?
        .l()
        .map_err(|e| e.to_string())?;

    if stream.is_null() {
        return Err(
            "openOutputStream returned null — URI may be invalid or access denied".to_string(),
        );
    }

    // Write in 64 KB chunks so we never allocate one giant JNI byte array,
    // which can exhaust the Java heap on memory-constrained devices.
    const CHUNK: usize = 65_536;
    let mut write_err: Option<String> = None;
    for chunk in bytes.chunks(CHUNK) {
        match env.byte_array_from_slice(chunk) {
            Ok(arr) => {
                if let Err(e) =
                    env.call_method(&stream, "write", "([B)V", &[JValue::Object(&*arr)])
                {
                    write_err = Some(e.to_string());
                    break;
                }
            }
            Err(e) => {
                write_err = Some(e.to_string());
                break;
            }
        }
    }

    // Always close the stream even when write failed — a leaked OutputStream
    // holds a file descriptor and may prevent the file from being visible.
    let _ = env.call_method(&stream, "close", "()V", &[]);

    if let Some(e) = write_err {
        return Err(format!("Write failed: {e}"));
    }
    Ok(())
}

// use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
                println!("a new app instance was opened with {argv:?} and the deep link event was already triggered");
            }))
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    #[cfg(target_os = "ios")]
    {
        builder = builder.plugin(tauri_plugin_ios_keyboard::init());
    }

    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        builder = builder.plugin(tauri_plugin_haptics::init());
    }

    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(tauri_plugin_dialog::init());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Register deep links at runtime for Linux and Windows (debug)
            // This enables AppImage support and development testing
            // Note: macOS doesn't support runtime registration
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
            Ok(())
        })
        .manage(SocketState(Arc::new(Mutex::new(HashMap::new()))))
        .invoke_handler(tauri::generate_handler![connect, disconnect, listen, send, download_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
