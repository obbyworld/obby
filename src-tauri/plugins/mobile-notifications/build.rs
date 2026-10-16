const COMMANDS: &[&str] = &[
    "configure_history_poll",
    "take_launch_target",
    "show_notification",
    "register_listener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
