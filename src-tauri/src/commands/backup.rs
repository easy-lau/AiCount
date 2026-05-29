use std::fs::File;
use std::io::{BufReader, Read, Write};

use serde::Serialize;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

use crate::code_stats;
use crate::paths;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub archived: u64,
    pub skipped: u64,
    pub dest: String,
}

#[tauri::command]
pub async fn backup_sessions(
    projects: Vec<String>,
    dest: String,
) -> Result<BackupResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out_file = File::create(&dest)
            .map_err(|e| format!("failed to create zip: {e}"))?;
        let mut zip = zip::ZipWriter::new(out_file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated);

        let claude_root = paths::get_claude_config_dir();
        let codex_root = paths::get_codex_config_dir();

        let all = code_stats::scan_all_with_paths();
        let mut archived: u64 = 0;
        let mut skipped: u64 = 0;

        for (path, stat) in &all {
            let cwd = stat.cwd.as_deref().unwrap_or("");
            if !projects.iter().any(|p| p == cwd) {
                continue;
            }
            if !code_stats::is_path_inside_known_roots(path) {
                skipped += 1;
                continue;
            }

            let zip_entry = if let Ok(rel) = path.strip_prefix(&claude_root) {
                format!("claude/{}", rel.to_string_lossy().replace('\\', "/"))
            } else if let Ok(rel) = path.strip_prefix(&codex_root) {
                format!("codex/{}", rel.to_string_lossy().replace('\\', "/"))
            } else {
                skipped += 1;
                continue;
            };

            let mut contents = Vec::new();
            let read_ok = File::open(path)
                .map(BufReader::new)
                .and_then(|mut r| r.read_to_end(&mut contents))
                .is_ok();
            if !read_ok {
                skipped += 1;
                continue;
            }

            zip.start_file(&zip_entry, options)
                .map_err(|e| format!("failed to write entry '{zip_entry}': {e}"))?;
            zip.write_all(&contents)
                .map_err(|e| format!("failed to write entry '{zip_entry}': {e}"))?;
            archived += 1;
        }

        zip.finish().map_err(|e| format!("failed to finalize zip: {e}"))?;
        Ok(BackupResult { archived, skipped, dest })
    })
    .await
    .map_err(|e| format!("backup_sessions join failed: {e}"))?
}
