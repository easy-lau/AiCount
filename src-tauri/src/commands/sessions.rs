use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::code_stats;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    /// Absolute path to the underlying JSONL file; used as the stable ID.
    pub id: String,
    pub provider: String,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub first_event_at: Option<i64>,
    pub last_active_at: Option<i64>,
    pub added: u64,
    pub removed: u64,
    pub file_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditEventDto {
    pub file_path: Option<String>,
    pub timestamp_ms: Option<i64>,
    pub added: u64,
    pub removed: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub summary: SessionSummary,
    pub events: Vec<EditEventDto>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsQuery {
    pub provider: Option<String>,
    pub project: Option<String>,
    pub from_ms: Option<i64>,
    pub to_ms: Option<i64>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

fn summarize(path: &PathBuf, stat: &code_stats::SessionStat) -> SessionSummary {
    let mut added: u64 = 0;
    let mut removed: u64 = 0;
    let mut first_event_at: Option<i64> = None;
    let mut file_set = std::collections::HashSet::new();
    for event in &stat.events {
        added += event.added;
        removed += event.removed;
        if let Some(p) = &event.file_path {
            file_set.insert(p.clone());
        }
        if let Some(ts) = event.timestamp_ms {
            first_event_at = Some(match first_event_at {
                Some(prev) => prev.min(ts),
                None => ts,
            });
        }
    }
    SessionSummary {
        id: path.to_string_lossy().to_string(),
        provider: stat.provider.clone(),
        cwd: stat.cwd.clone(),
        model: stat.model.clone(),
        first_event_at,
        last_active_at: stat.last_active_at,
        added,
        removed,
        file_count: file_set.len() as u64,
    }
}

#[tauri::command]
pub async fn list_sessions(
    query: Option<ListSessionsQuery>,
) -> Result<Vec<SessionSummary>, String> {
    let q = query.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let all = code_stats::scan_all_with_paths();
        let provider_filter = q.provider.as_deref();
        let project_filter = q.project.as_deref();
        let from_ms = q.from_ms;
        let to_ms = q.to_ms;
        let limit = q.limit.unwrap_or(200);
        let offset = q.offset.unwrap_or(0);

        let mut summaries: Vec<SessionSummary> = all
            .iter()
            .filter(|(_, s)| match provider_filter {
                Some(p) if !p.is_empty() => s.provider == p,
                _ => true,
            })
            .filter(|(_, s)| match project_filter {
                Some(p) if !p.is_empty() => s.cwd.as_deref() == Some(p),
                _ => true,
            })
            .filter(|(_, s)| match (from_ms, s.last_active_at) {
                (Some(from), Some(ts)) => ts >= from,
                (Some(_), None) => false,
                _ => true,
            })
            .filter(|(_, s)| match (to_ms, s.last_active_at) {
                (Some(to), Some(ts)) => ts <= to,
                (Some(_), None) => false,
                _ => true,
            })
            .map(|(path, stat)| summarize(path, stat))
            .collect();
        summaries.sort_by(|a, b| {
            b.last_active_at
                .unwrap_or(0)
                .cmp(&a.last_active_at.unwrap_or(0))
        });
        let slice: Vec<SessionSummary> = summaries
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect();
        slice
    })
    .await
    .map_err(|e| format!("list_sessions failed: {e}"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectOutcome {
    pub deleted: u64,
    pub failed: u64,
}

#[tauri::command]
pub async fn delete_project(
    app: AppHandle,
    project: String,
) -> Result<DeleteProjectOutcome, String> {
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let all = code_stats::scan_all_with_paths();
        let mut deleted: u64 = 0;
        let mut failed: u64 = 0;
        for (path, stat) in all {
            let key = stat
                .cwd
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            if key != project {
                continue;
            }
            if !code_stats::is_path_inside_known_roots(&path) {
                failed += 1;
                continue;
            }
            code_stats::invalidate_cache_for(&path);
            if std::fs::remove_file(&path).is_ok() {
                deleted += 1;
            } else {
                failed += 1;
            }
        }
        DeleteProjectOutcome { deleted, failed }
    })
    .await
    .map_err(|e| format!("delete_project join failed: {e}"))?;
    let _ = app.emit("session-changed", ());
    Ok(outcome)
}

#[tauri::command]
pub async fn delete_session(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking({
        let id_for_task = id.clone();
        move || {
            let path = PathBuf::from(&id_for_task);
            if !code_stats::is_path_inside_known_roots(&path) {
                return Err(format!(
                    "session id rejected (outside known data roots): {id_for_task}"
                ));
            }
            code_stats::invalidate_cache_for(&path);
            std::fs::remove_file(&path)
                .map_err(|e| format!("delete failed: {e} ({})", path.display()))?;
            Ok(())
        }
    })
    .await
    .map_err(|e| format!("delete_session join failed: {e}"))??;
    let _ = app.emit("session-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn get_session_detail(id: String) -> Result<SessionDetail, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&id);
        if !code_stats::is_path_inside_known_roots(&path) {
            return Err::<SessionDetail, String>(format!(
                "session id rejected (outside known data roots): {id}"
            ));
        }
        let (stat, _provider) = code_stats::parse_session_file(&path)
            .ok_or_else(|| format!("failed to parse session: {id}"))?;
        let summary = summarize(&path, &stat);
        let events: Vec<EditEventDto> = stat
            .events
            .iter()
            .map(|e| EditEventDto {
                file_path: e.file_path.clone(),
                timestamp_ms: e.timestamp_ms,
                added: e.added,
                removed: e.removed,
            })
            .collect();
        Ok(SessionDetail { summary, events })
    })
    .await
    .map_err(|e| format!("get_session_detail failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::code_stats::is_path_inside_known_roots;

    #[test]
    fn path_outside_known_roots_is_rejected() {
        // Pick paths that exist but live well outside ~/.claude and ~/.codex.
        for bogus in ["/etc/hosts", "/etc/passwd", "/tmp", "/"] {
            let p = PathBuf::from(bogus);
            if !p.exists() {
                continue;
            }
            assert!(
                !is_path_inside_known_roots(&p),
                "path {bogus:?} should be rejected by known-roots check"
            );
        }
    }

    #[test]
    fn nonexistent_path_is_rejected() {
        let p = PathBuf::from("/nonexistent-aicount-session.jsonl");
        assert!(!is_path_inside_known_roots(&p));
    }
}
