mod paths;
mod code_stats;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::code_stats::compute_code_stats,
            commands::code_stats::list_projects,
            commands::code_stats::compute_overview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
