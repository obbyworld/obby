const COMMANDS: &[&str] = &[
    "configure_history_poll",
    "take_launch_target",
    "show_notification",
    "push_status",
    "pick_push_distributor",
    "register_push",
    "unregister_push",
    "push_instances",
    "register_listener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
