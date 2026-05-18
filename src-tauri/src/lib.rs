mod paths;
mod code_stats;
mod commands;
mod tray;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(e) = tray::init(&handle) {
                log::warn!("tray init failed: {e}");
            }
            if let Err(e) = watcher::spawn_session_watcher(handle.clone()) {
                log::warn!("watcher init failed: {e}");
            }
            tray::update_tooltip(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::code_stats::compute_code_stats,
            commands::code_stats::list_projects,
            commands::code_stats::compute_overview,
            commands::code_stats::compute_today_loc,
            commands::code_stats::compute_heatmap,
            commands::code_stats::export_overview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
