const COMMANDS: &[&str] = &["configure", "take_launch_target", "register_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
