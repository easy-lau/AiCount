use tauri::{AppHandle, Emitter};

use crate::settings::UserSettings;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedDataDirs {
    pub claude_dir: String,
    pub codex_dir: String,
}

#[tauri::command]
pub async fn get_settings() -> Result<UserSettings, String> {
    tauri::async_runtime::spawn_blocking(crate::settings::load)
        .await
        .map_err(|e| format!("get_settings failed: {e}"))
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: UserSettings) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::settings::save(&settings))
        .await
        .map_err(|e| format!("save_settings join failed: {e}"))?
        .map_err(|e| format!("save_settings failed: {e}"))?;
    let _ = app.emit("session-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn get_data_dirs() -> Result<ResolvedDataDirs, String> {
    tauri::async_runtime::spawn_blocking(|| ResolvedDataDirs {
        claude_dir: crate::paths::get_claude_config_dir()
            .to_string_lossy()
            .to_string(),
        codex_dir: crate::paths::get_codex_config_dir()
            .to_string_lossy()
            .to_string(),
    })
    .await
    .map_err(|e| format!("get_data_dirs failed: {e}"))
}

/// Sync the native window chrome (macOS/Windows title bar) with the user's
/// theme. `theme` accepts "light", "dark", or anything else (treated as
/// system / follow OS).
#[tauri::command]
pub async fn set_window_theme(window: tauri::Window, theme: String) -> Result<(), String> {
    use tauri::Theme;
    let tauri_theme = match theme.as_str() {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    };
    window.set_theme(tauri_theme).map_err(|e| e.to_string())
}
