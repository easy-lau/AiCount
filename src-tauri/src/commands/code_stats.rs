use std::io::Write as _;

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

#[tauri::command]
pub async fn list_languages() -> Result<Vec<code_stats::LanguageOption>, String> {
    tauri::async_runtime::spawn_blocking(code_stats::list_languages)
        .await
        .map_err(|e| format!("list_languages failed: {e}"))
}

#[derive(serde::Deserialize, Clone)]
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

#[tauri::command]
pub async fn compute_today_loc() -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(crate::tray::compute_today_loc)
        .await
        .map_err(|e| format!("compute_today_loc failed: {e}"))
}

#[tauri::command]
pub async fn compute_heatmap(
    project: Option<String>,
) -> Result<code_stats::HeatmapData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let from_ms = now_ms - 365 * 86_400 * 1000;
        code_stats::compute_heatmap(project.as_deref(), from_ms, now_ms)
    })
    .await
    .map_err(|e| format!("compute_heatmap failed: {e}"))
}

#[tauri::command]
pub async fn export_overview(
    query: OverviewQuery,
    format: String,
    dest_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let overview = code_stats::compute_overview(
            query.project.as_deref(),
            query.from_ms,
            query.to_ms,
        );
        match format.as_str() {
            "json" => {
                let body = serde_json::to_string_pretty(&overview)
                    .map_err(|e| format!("serialize json failed: {e}"))?;
                std::fs::write(&dest_path, body)
                    .map_err(|e| format!("write file failed: {e}"))?;
                Ok(())
            }
            "csv" => {
                let body = build_csv(&overview)
                    .map_err(|e| format!("build csv failed: {e}"))?;
                let mut out = Vec::with_capacity(body.len() + 3);
                out.extend_from_slice("\u{FEFF}".as_bytes());
                out.extend_from_slice(&body);
                std::fs::write(&dest_path, out)
                    .map_err(|e| format!("write file failed: {e}"))?;
                Ok(())
            }
            other => Err(format!("unsupported format: {other}")),
        }
    })
    .await
    .map_err(|e| format!("export_overview failed: {e}"))?
}

fn build_csv(overview: &code_stats::Overview) -> std::io::Result<Vec<u8>> {
    let mut buf: Vec<u8> = Vec::new();

    writeln!(buf, "-- Summary --")?;
    {
        let mut w = csv::Writer::from_writer(&mut buf);
        w.write_record(["metric", "value"])?;
        w.write_record(["total_loc", &overview.total_loc.to_string()])?;
        w.write_record(["total_files", &overview.total_files.to_string()])?;
        w.write_record([
            "ai_ratio_percent",
            &format!("{:.2}", overview.ai_ratio_percent),
        ])?;
        w.write_record(["total_project_loc", &overview.total_project_loc.to_string()])?;
        w.write_record(["session_count", &overview.session_count.to_string()])?;
        w.write_record(["range_from_ms", &overview.range_from_ms.to_string()])?;
        w.write_record(["range_to_ms", &overview.range_to_ms.to_string()])?;
        w.flush()?;
    }

    writeln!(buf)?;
    writeln!(buf, "-- Daily --")?;
    {
        let mut w = csv::Writer::from_writer(&mut buf);
        w.write_record(["date", "loc", "files"])?;
        for d in &overview.daily {
            w.write_record([d.date.as_str(), &d.loc.to_string(), &d.files.to_string()])?;
        }
        w.flush()?;
    }

    writeln!(buf)?;
    writeln!(buf, "-- By Language --")?;
    {
        let mut w = csv::Writer::from_writer(&mut buf);
        w.write_record(["language", "extension", "loc", "file_count", "percent"])?;
        for l in &overview.by_language {
            w.write_record([
                l.language.as_str(),
                l.extension.as_str(),
                &l.loc.to_string(),
                &l.file_count.to_string(),
                &format!("{:.2}", l.percent),
            ])?;
        }
        w.flush()?;
    }

    Ok(buf)
}
