use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use crate::paths::get_codex_config_dir;

use super::{collect_jsonl_files, parse_ts, parse_with_cache, EditEvent, SessionStat};

const PROVIDER: &str = "codex";

pub fn scan_all() -> Vec<SessionStat> {
    let root = get_codex_config_dir().join("sessions");
    let mut files = Vec::new();
    collect_jsonl_files(&root, &mut files);
    files
        .into_iter()
        .filter_map(|p| parse_with_cache(&p, parse_session))
        .collect()
}

pub fn parse_session(path: &Path) -> Option<SessionStat> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut events: Vec<EditEvent> = Vec::new();
    let mut cwd: Option<String> = None;
    let mut last_active_at: Option<i64> = None;
    let mut model: Option<String> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(v) => v,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let ts = value.get("timestamp").and_then(parse_ts);
        if let Some(ts_v) = ts {
            last_active_at = Some(match last_active_at {
                Some(existing) => existing.max(ts_v),
                None => ts_v,
            });
        }

        let row_type = value.get("type").and_then(Value::as_str).unwrap_or("");

        if row_type == "session_meta" {
            if cwd.is_none() {
                cwd = value
                    .get("payload")
                    .and_then(|p| p.get("cwd"))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string());
            }
            if model.is_none() {
                if let Some(m) = value
                    .get("payload")
                    .and_then(|p| p.get("model"))
                    .and_then(Value::as_str)
                {
                    if !m.is_empty() {
                        model = Some(m.to_string());
                    }
                }
            }
            continue;
        }

        // Newer codex CLI (v0.130+) emits the model in turn_context events
        // instead of session_meta. Fall back to it when session_meta is silent.
        if row_type == "turn_context" {
            if model.is_none() {
                if let Some(m) = value
                    .get("payload")
                    .and_then(|p| p.get("model"))
                    .and_then(Value::as_str)
                {
                    if !m.is_empty() {
                        model = Some(m.to_string());
                    }
                }
            }
            continue;
        }

        if row_type != "response_item" {
            continue;
        }
        let payload = match value.get("payload") {
            Some(p) => p,
            None => continue,
        };

        // Newer codex CLI (v0.64+) emits apply_patch as a custom_tool_call with
        // the patch body in `input` directly (no shell heredoc wrapper).
        if payload.get("type").and_then(Value::as_str) == Some("custom_tool_call")
            && payload.get("name").and_then(Value::as_str) == Some("apply_patch")
        {
            let patch_body = payload
                .get("input")
                .and_then(Value::as_str)
                .unwrap_or("");
            let (added, removed, file_path) = parse_apply_patch(patch_body);
            if added == 0 && removed == 0 {
                continue;
            }
            events.push(EditEvent {
                file_path,
                timestamp_ms: ts,
                added,
                removed,
            });
            continue;
        }

        if payload.get("type").and_then(Value::as_str) != Some("function_call") {
            continue;
        }

        let name = payload.get("name").and_then(Value::as_str).unwrap_or("");
        // The spec calls this "exec_command"; some codex versions emit "shell".
        if name != "exec_command" && name != "shell" {
            continue;
        }

        let args_str = payload
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("");
        let args_json: Value = match serde_json::from_str(args_str) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let cmd_str = match args_json.get("cmd") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Array(arr)) => arr
                .iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
            _ => continue,
        };

        let (added, removed, file_path) = parse_apply_patch(&cmd_str);
        if added == 0 && removed == 0 {
            continue;
        }

        events.push(EditEvent {
            file_path,
            timestamp_ms: ts,
            added,
            removed,
        });
    }

    Some(SessionStat {
        provider: PROVIDER.to_string(),
        cwd,
        events,
        last_active_at,
        model,
    })
}

/// Parse one `apply_patch` body out of an exec_command `cmd` string.
/// Returns (added, removed, first_file_path_seen).
pub(crate) fn parse_apply_patch(cmd: &str) -> (u64, u64, Option<String>) {
    let begin = match cmd.find("*** Begin Patch") {
        Some(i) => i,
        None => return (0, 0, None),
    };
    let after_begin = &cmd[begin..];
    let end_offset = match after_begin.find("*** End Patch") {
        Some(i) => i,
        None => return (0, 0, None),
    };
    let body = &after_begin[..end_offset];

    let mut added = 0u64;
    let mut removed = 0u64;
    let mut file_path: Option<String> = None;

    for line in body.lines() {
        if line.starts_with("*** ") {
            if file_path.is_none() {
                for prefix in [
                    "*** Update File: ",
                    "*** Add File: ",
                    "*** Delete File: ",
                ] {
                    if let Some(rest) = line.strip_prefix(prefix) {
                        let trimmed = rest.trim();
                        if !trimmed.is_empty() {
                            file_path = Some(trimmed.to_string());
                        }
                        break;
                    }
                }
            }
            continue;
        }
        // Defensive: ignore unified-diff style headers if they appear
        if line.starts_with("+++ ") || line.starts_with("--- ") || line.starts_with("@@ ") {
            continue;
        }
        if line.starts_with('+') {
            added += 1;
        } else if line.starts_with('-') {
            removed += 1;
        }
    }

    (added, removed, file_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn codex_apply_patch_counts_added_and_removed_in_heredoc() {
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join("session.jsonl");

        // Two added lines (+ foo, + bar), one removed (- baz), inside `*** Begin/End Patch`
        // wrapped in a `bash -c "apply_patch <<'EOF' ... EOF"` shell invocation.
        let cmd_body = "apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: src/foo.rs\n+ foo\n+ bar\n- baz\n*** End Patch\nEOF\n";
        let args_obj = serde_json::json!({ "cmd": ["bash", "-lc", cmd_body] });
        let args_str = serde_json::to_string(&args_obj).unwrap();

        let line1 = serde_json::json!({
            "timestamp": "2026-05-14T10:00:00Z",
            "type": "session_meta",
            "payload": {"id": "abc", "cwd": "/tmp/proj"}
        });
        let line2 = serde_json::json!({
            "timestamp": "2026-05-14T10:01:00Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "arguments": args_str,
                "call_id": "c1"
            }
        });
        let content = format!("{}\n{}\n", line1, line2);
        std::fs::write(&path, content).expect("write fixture");

        let stat = parse_session(&path).expect("parse");
        let total = stat.total();
        assert_eq!(total.added, 2);
        assert_eq!(total.removed, 1);
        assert_eq!(stat.cwd.as_deref(), Some("/tmp/proj"));
        assert_eq!(stat.events.len(), 1);
        assert_eq!(stat.events[0].file_path.as_deref(), Some("src/foo.rs"));
    }

    #[test]
    fn codex_apply_patch_handles_custom_tool_call_schema_v064() {
        // codex CLI v0.64+ emits apply_patch as a custom_tool_call with the
        // patch body directly in `input` (no shell heredoc wrapper).
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join("session.jsonl");

        let patch_body = "*** Begin Patch\n*** Add File: README.md\n+ hello\n+ world\n- bye\n*** End Patch\n";
        let line1 = serde_json::json!({
            "timestamp": "2026-05-14T10:00:00Z",
            "type": "session_meta",
            "payload": {"id": "abc", "cwd": "/tmp/proj"}
        });
        let line2 = serde_json::json!({
            "timestamp": "2026-05-14T10:01:00Z",
            "type": "response_item",
            "payload": {
                "type": "custom_tool_call",
                "status": "completed",
                "call_id": "c1",
                "name": "apply_patch",
                "input": patch_body
            }
        });
        let content = format!("{}\n{}\n", line1, line2);
        std::fs::write(&path, content).expect("write fixture");

        let stat = parse_session(&path).expect("parse");
        let total = stat.total();
        assert_eq!(total.added, 2);
        assert_eq!(total.removed, 1);
        assert_eq!(stat.events.len(), 1);
        assert_eq!(stat.events[0].file_path.as_deref(), Some("README.md"));
    }

    #[test]
    fn codex_apply_patch_skips_diff_style_headers() {
        // `+++ foo` and `--- bar` and `*** Update File: ...` must not be counted as +/-
        let cmd = "apply_patch <<EOF\n*** Begin Patch\n*** Update File: a.rs\n+++ a.rs\n--- a.rs\n@@ -1 +1 @@\n+ keep\n- drop\n*** End Patch\nEOF";
        let (added, removed, fp) = parse_apply_patch(cmd);
        assert_eq!(added, 1);
        assert_eq!(removed, 1);
        assert_eq!(fp.as_deref(), Some("a.rs"));
    }

    #[test]
    fn codex_skips_non_apply_patch_function_calls() {
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join("session.jsonl");

        let args = serde_json::json!({ "cmd": ["ls", "-la"] }).to_string();
        let content = format!(
            "{}\n{}\n",
            serde_json::json!({
                "timestamp":"2026-05-14T10:00:00Z","type":"session_meta",
                "payload":{"id":"abc","cwd":"/tmp/proj"}
            }),
            serde_json::json!({
                "timestamp":"2026-05-14T10:01:00Z","type":"response_item",
                "payload":{"type":"function_call","name":"exec_command","arguments":args}
            })
        );
        std::fs::write(&path, content).expect("write fixture");

        let stat = parse_session(&path).expect("parse");
        assert_eq!(stat.events.len(), 0);
        assert_eq!(stat.total().added, 0);
    }
}
