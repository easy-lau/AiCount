use std::path::PathBuf;
use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::code_stats;
use crate::paths;
use crate::tray;

pub fn spawn_session_watcher(app: AppHandle) -> notify::Result<()> {
    let claude_dir = paths::get_claude_config_dir().join("projects");
    let codex_dir = paths::get_codex_config_dir().join("sessions");

    let watch_targets: Vec<PathBuf> = [claude_dir, codex_dir]
        .into_iter()
        .filter(|p| {
            if p.exists() {
                true
            } else {
                log::warn!("session watcher: path does not exist, skipping: {}", p.display());
                false
            }
        })
        .collect();

    if watch_targets.is_empty() {
        log::warn!("session watcher: no session directories found, watcher not started");
        return Ok(());
    }

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let mut debouncer = match new_debouncer(Duration::from_millis(500), tx) {
            Ok(d) => d,
            Err(e) => {
                log::error!("session watcher: failed to create debouncer: {e}");
                return;
            }
        };

        for target in &watch_targets {
            if let Err(e) = debouncer
                .watcher()
                .watch(target, RecursiveMode::Recursive)
            {
                log::warn!(
                    "session watcher: failed to watch {}: {}",
                    target.display(),
                    e
                );
            }
        }

        for res in rx {
            match res {
                Ok(events) => {
                    for ev in events {
                        let path = ev.path;
                        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                            continue;
                        }
                        code_stats::invalidate_cache_for(&path);
                        let path_str = path.to_string_lossy().to_string();
                        if let Err(e) =
                            app.emit("session-changed", json!({ "path": path_str }))
                        {
                            log::warn!("session watcher: emit failed: {e}");
                        }
                        tray::update_tooltip(&app);
                    }
                }
                Err(error) => {
                    log::warn!("session watcher: event error: {error}");
                }
            }
        }
    });

    Ok(())
}
