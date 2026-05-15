use crate::code_stats;

#[tauri::command]
pub async fn compute_code_stats(
    project: Option<String>,
) -> Result<code_stats::CodeStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        code_stats::compute_stats_filtered(project.as_deref())
    })
    .await
    .map_err(|e| format!("compute_code_stats failed: {e}"))
}

#[tauri::command]
pub async fn list_projects() -> Result<Vec<code_stats::ProjectInfo>, String> {
    tauri::async_runtime::spawn_blocking(code_stats::list_projects)
        .await
        .map_err(|e| format!("list_projects failed: {e}"))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewQuery {
    pub project: Option<String>,
    pub from_ms: i64,
    pub to_ms: i64,
}

#[tauri::command]
pub async fn compute_overview(
    query: OverviewQuery,
) -> Result<code_stats::Overview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        code_stats::compute_overview(query.project.as_deref(), query.from_ms, query.to_ms)
    })
    .await
    .map_err(|e| format!("compute_overview failed: {e}"))
}
