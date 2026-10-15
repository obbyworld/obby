const COMMANDS: &[&str] = &["configure", "run_now", "take_launch_target"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
