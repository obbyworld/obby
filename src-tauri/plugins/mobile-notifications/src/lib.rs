//! Routes taps on mobile notifications to the app, and runs the history poll:
//! the fallback for servers without web push.

#[cfg(mobile)]
use serde::Serialize;
use serde_json::Value;
#[cfg(mobile)]
use tauri::{plugin::PluginHandle, Manager};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_mobile_notifications);

#[cfg(target_os = "ios")]
extern "C" {
    fn obby_register_history_poll();
}

#[cfg(mobile)]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigureHistoryPollArgs {
    /// The history poll config as JSON, or none to stop polling.
    config: Option<String>,
    interval_minutes: u32,
}

#[cfg(mobile)]
struct Native<R: Runtime>(PluginHandle<R>);

#[tauri::command]
async fn configure_history_poll<R: Runtime>(
    _app: tauri::AppHandle<R>,
    config: Option<String>,
    interval_minutes: u32,
) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let args = ConfigureHistoryPollArgs {
            config,
            interval_minutes,
        };
        _app.state::<Native<R>>()
            .0
            .run_mobile_plugin::<Value>("configureHistoryPoll", args)
            .map_err(|e| e.to_string())?;
    }
    #[cfg(desktop)]
    let _ = (config, interval_minutes);
    Ok(())
}

#[tauri::command]
async fn take_launch_target<R: Runtime>(_app: tauri::AppHandle<R>) -> Result<Value, String> {
    #[cfg(mobile)]
    return _app
        .state::<Native<R>>()
        .0
        .run_mobile_plugin::<Value>("takeLaunchTarget", ())
        .map_err(|e| e.to_string());
    #[cfg(desktop)]
    Ok(Value::Null)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    // iOS only accepts background task handlers registered before the app
    // finishes launching, so we register before the event loop starts.
    #[cfg(target_os = "ios")]
    unsafe {
        obby_register_history_poll()
    };
    Builder::new("mobile-notifications")
        .invoke_handler(tauri::generate_handler![
            configure_history_poll,
            take_launch_target
        ])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api
                .register_android_plugin("world.obby.notifications", "MobileNotificationsPlugin")?;
            #[cfg(target_os = "ios")]
            let handle = _api.register_ios_plugin(init_plugin_mobile_notifications)?;
            #[cfg(mobile)]
            _app.manage(Native(handle));
            Ok(())
        })
        .build()
}
