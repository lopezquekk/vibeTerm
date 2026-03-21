// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Install a panic hook BEFORE anything else so we can see the real panic
    // message even when it gets wrapped by "panic in a function that cannot unwind"
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[vibeterm-panic] {info}");
    }));
    vibeterm_lib::run()
}
