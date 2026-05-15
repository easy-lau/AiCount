use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use crate::paths::get_claude_config_dir;

use super::{
    collect_jsonl_files, count_newlines, parse_ts, parse_with_cache, EditEvent, SessionStat,
};

const PROVIDER: &str = "claude";

pub fn scan_all() -> Vec<SessionStat> {
    let root = get_claude_config_dir().join("projects");
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

        if cwd.is_none() {
            cwd = value
                .get("cwd")
                .and_then(Value::as_str)
                .map(|s| s.to_string());
        }
        let ts = value.get("timestamp").and_then(parse_ts);
        if let Some(ts_v) = ts {
            last_active_at = Some(match last_active_at {
                Some(existing) => existing.max(ts_v),
                None => ts_v,
            });
        }

        let message = match value.get("message") {
            Some(Value::Object(_)) => value.get("message").unwrap(),
            _ => continue,
        };
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        if model.is_none() {
            if let Some(m) = message.get("model").and_then(Value::as_str) {
                // Skip synthetic / angle-bracket placeholders like "<synthetic>"
                // which represent hook outputs or prefilled turns, not real models.
                if !m.is_empty() && !m.starts_with('<') {
                    model = Some(m.to_string());
                }
            }
        }
        let content_items = match message.get("content") {
            Some(Value::Array(arr)) => arr,
            _ => continue,
        };

        for item in content_items {
            if item.get("type").and_then(Value::as_str) != Some("tool_use") {
                continue;
            }
            let name = item.get("name").and_then(Value::as_str).unwrap_or("");
            let input = match item.get("input") {
                Some(i) => i,
                None => continue,
            };

            let (added, removed, file_path) = match name {
                "Write" => {
                    let content_str = input
                        .get("content")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let fp = input
                        .get("file_path")
                        .and_then(Value::as_str)
                        .map(|s| s.to_string());
                    (count_newlines(content_str), 0u64, fp)
                }
                "Edit" => {
                    let new_s = input
                        .get("new_string")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let old_s = input
                        .get("old_string")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let fp = input
                        .get("file_path")
                        .and_then(Value::as_str)
                        .map(|s| s.to_string());
                    (count_newlines(new_s), count_newlines(old_s), fp)
                }
                "MultiEdit" => {
                    let edits = match input.get("edits").and_then(|v| v.as_array()) {
                        Some(e) => e,
                        None => continue,
                    };
                    let fp = input
                        .get("file_path")
                        .and_then(Value::as_str)
                        .map(|s| s.to_string());
                    let mut a = 0u64;
                    let mut r = 0u64;
                    for e in edits {
                        let new_s =
                            e.get("new_string").and_then(Value::as_str).unwrap_or("");
                        let old_s =
                            e.get("old_string").and_then(Value::as_str).unwrap_or("");
                        a += count_newlines(new_s);
                        r += count_newlines(old_s);
                    }
                    (a, r, fp)
                }
                "NotebookEdit" => {
                    let new_s = input
                        .get("new_source")
                        .and_then(Value::as_str)
                        .or_else(|| input.get("new_string").and_then(Value::as_str))
                        .unwrap_or("");
                    let fp = input
                        .get("notebook_path")
                        .and_then(Value::as_str)
                        .or_else(|| input.get("file_path").and_then(Value::as_str))
                        .map(|s| s.to_string());
                    (count_newlines(new_s), 0u64, fp)
                }
                _ => continue,
            };

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
    }

    Some(SessionStat {
        provider: PROVIDER.to_string(),
        cwd,
        events,
        last_active_at,
        model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn claude_counts_write_edit_and_multiedit_loc() {
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join("session.jsonl");

        // Write: content has 10 newlines -> +10
        // Edit:  new_string has 3 newlines, old_string has 1 newline -> +3/-1
        // MultiEdit (one entry): new has 5 newlines, old has 2 newlines -> +5/-2
        let content = concat!(
            "{\"sessionId\":\"s1\",\"cwd\":\"/tmp/proj\",\"timestamp\":\"2026-05-14T10:00:00Z\"}\n",
            "{\"timestamp\":\"2026-05-14T10:01:00Z\",\"cwd\":\"/tmp/proj\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"name\":\"Write\",\"input\":{\"file_path\":\"a.txt\",\"content\":\"1\\n2\\n3\\n4\\n5\\n6\\n7\\n8\\n9\\n10\\n\"}}]}}\n",
            "{\"timestamp\":\"2026-05-14T10:02:00Z\",\"cwd\":\"/tmp/proj\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"name\":\"Edit\",\"input\":{\"file_path\":\"b.txt\",\"old_string\":\"z\\n\",\"new_string\":\"a\\nb\\nc\\n\"}}]}}\n",
            "{\"timestamp\":\"2026-05-14T10:03:00Z\",\"cwd\":\"/tmp/proj\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"name\":\"MultiEdit\",\"input\":{\"file_path\":\"c.txt\",\"edits\":[{\"old_string\":\"x\\ny\\n\",\"new_string\":\"p\\nq\\nr\\ns\\nt\\n\"}]}}]}}\n",
        );
        std::fs::write(&path, content).expect("write fixture");

        let stat = parse_session(&path).expect("parse session");
        let total = stat.total();
        assert_eq!(total.added, 18);
        assert_eq!(total.removed, 3);
        assert_eq!(stat.cwd.as_deref(), Some("/tmp/proj"));
        assert_eq!(stat.events.len(), 3);
    }

    #[test]
    fn claude_skips_non_whitelisted_tools() {
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join("session.jsonl");

        let content = concat!(
            "{\"sessionId\":\"s1\",\"cwd\":\"/tmp/proj\",\"timestamp\":\"2026-05-14T10:00:00Z\"}\n",
            // Read tool with content that has many newlines - must NOT be counted
            "{\"timestamp\":\"2026-05-14T10:01:00Z\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"name\":\"Read\",\"input\":{\"file_path\":\"big.txt\",\"content\":\"a\\nb\\nc\\nd\\ne\\n\"}}]}}\n",
            // Bash tool
            "{\"timestamp\":\"2026-05-14T10:02:00Z\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"ls\\n\"}}]}}\n",
        );
        std::fs::write(&path, content).expect("write fixture");

        let stat = parse_session(&path).expect("parse session");
        assert_eq!(stat.events.len(), 0);
        assert_eq!(stat.total().added, 0);
    }

    #[test]
    fn claude_skips_user_role_even_with_tool_use_shape() {
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join("session.jsonl");

        // A user message that incorrectly references a Write tool_use - must NOT be counted
        let content = concat!(
            "{\"sessionId\":\"s1\",\"cwd\":\"/tmp/proj\",\"timestamp\":\"2026-05-14T10:00:00Z\"}\n",
            "{\"timestamp\":\"2026-05-14T10:01:00Z\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"tool_use\",\"name\":\"Write\",\"input\":{\"content\":\"a\\nb\\n\"}}]}}\n",
        );
        std::fs::write(&path, content).expect("write fixture");

        let stat = parse_session(&path).expect("parse session");
        assert_eq!(stat.events.len(), 0);
    }
}
