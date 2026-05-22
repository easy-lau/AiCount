pub mod claude;
pub mod codex;
pub mod project_loc;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use chrono::{Duration as ChronoDuration, Local, TimeZone};
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocDelta {
    pub added: u64,
    pub removed: u64,
}

impl LocDelta {
    fn accumulate(&mut self, added: u64, removed: u64) {
        self.added += added;
        self.removed += removed;
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLoc {
    pub path: String,
    pub delta: LocDelta,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeStats {
    pub total: LocDelta,
    pub by_provider: HashMap<String, LocDelta>,
    pub by_project: HashMap<String, LocDelta>,
    pub top_files: Vec<FileLoc>,
    pub this_week: LocDelta,
    pub this_month: LocDelta,
    pub session_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    pub session_count: u64,
    pub last_active_at: Option<i64>,
    pub net_loc: i64,
}

#[derive(Debug, Clone, Default)]
pub struct EditEvent {
    pub file_path: Option<String>,
    pub timestamp_ms: Option<i64>,
    pub added: u64,
    pub removed: u64,
}

#[derive(Debug, Clone)]
pub struct SessionStat {
    pub provider: String,
    pub cwd: Option<String>,
    pub events: Vec<EditEvent>,
    pub last_active_at: Option<i64>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyBucket {
    pub date: String,
    pub loc: u64,
    pub files: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelBreakdown {
    pub model: String,
    pub loc: u64,
    pub file_count: u64,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageBreakdown {
    pub language: String,
    pub extension: String,
    pub loc: u64,
    pub file_count: u32,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapCell {
    pub date: String,
    pub loc: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapData {
    pub from_ms: i64,
    pub to_ms: i64,
    pub cells: Vec<HeatmapCell>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub total_loc: u64,
    pub total_files: u64,
    pub loc_delta_percent: Option<f64>,
    pub files_delta_percent: Option<f64>,
    pub daily: Vec<DailyBucket>,
    pub by_model: Vec<ModelBreakdown>,
    pub by_language: Vec<LanguageBreakdown>,
    pub session_count: u64,
    pub range_from_ms: i64,
    pub range_to_ms: i64,
    pub total_project_loc: u64,
    pub ai_ratio_percent: f64,
    pub ai_ratio_delta_percent: Option<f64>,
}

impl SessionStat {
    #[allow(dead_code)]
    pub fn total(&self) -> LocDelta {
        let mut d = LocDelta::default();
        for e in &self.events {
            d.added += e.added;
            d.removed += e.removed;
        }
        d
    }
}

static CACHE: Lazy<Mutex<HashMap<PathBuf, (SystemTime, SessionStat)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub(crate) fn parse_with_cache<F>(path: &Path, parser: F) -> Option<SessionStat>
where
    F: FnOnce(&Path) -> Option<SessionStat>,
{
    let mtime = std::fs::metadata(path).ok()?.modified().ok()?;
    if let Ok(cache) = CACHE.lock() {
        if let Some((cached_mtime, stat)) = cache.get(path) {
            if *cached_mtime == mtime {
                return Some(stat.clone());
            }
        }
    }

    let stat = parser(path)?;
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(path.to_path_buf(), (mtime, stat.clone()));
    }
    Some(stat)
}

pub fn invalidate_cache_for(path: &Path) {
    if let Ok(mut cache) = CACHE.lock() {
        cache.remove(path);
    }
}

/// Scan all sessions for both providers and return them paired with the
/// underlying JSONL file path. Used by the sessions list command.
pub fn scan_all_with_paths() -> Vec<(PathBuf, SessionStat)> {
    let mut out: Vec<(PathBuf, SessionStat)> = Vec::new();
    let claude_root = crate::paths::get_claude_config_dir().join("projects");
    let codex_root = crate::paths::get_codex_config_dir().join("sessions");

    let mut claude_files = Vec::new();
    collect_jsonl_files(&claude_root, &mut claude_files);
    for p in claude_files {
        if let Some(stat) = parse_with_cache(&p, claude::parse_session) {
            out.push((p, stat));
        }
    }

    let mut codex_files = Vec::new();
    collect_jsonl_files(&codex_root, &mut codex_files);
    for p in codex_files {
        if let Some(stat) = parse_with_cache(&p, codex::parse_session) {
            out.push((p, stat));
        }
    }
    out
}

/// Parse a single session JSONL file by its absolute path. Used by the
/// session detail command after validating the path is inside one of the
/// known data directories.
pub fn parse_session_file(path: &Path) -> Option<(SessionStat, &'static str)> {
    // Determine provider by which configured root the path lives under.
    let claude_root = crate::paths::get_claude_config_dir();
    let codex_root = crate::paths::get_codex_config_dir();
    let canon = path.canonicalize().ok()?;
    let in_claude = path_has_prefix(&canon, &claude_root);
    let in_codex = path_has_prefix(&canon, &codex_root);
    if in_claude {
        parse_with_cache(path, claude::parse_session).map(|s| (s, "claude"))
    } else if in_codex {
        parse_with_cache(path, codex::parse_session).map(|s| (s, "codex"))
    } else {
        None
    }
}

fn path_has_prefix(path: &Path, prefix: &Path) -> bool {
    let canon_prefix = match prefix.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    path.starts_with(&canon_prefix)
}

pub fn is_path_inside_known_roots(path: &Path) -> bool {
    let canon = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    path_has_prefix(&canon, &crate::paths::get_claude_config_dir())
        || path_has_prefix(&canon, &crate::paths::get_codex_config_dir())
}

pub fn ext_to_language(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "rs" => "Rust",
        "ts" | "tsx" => "TypeScript",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "py" => "Python",
        "go" => "Go",
        "java" => "Java",
        "kt" | "kts" => "Kotlin",
        "scala" => "Scala",
        "c" | "cc" | "cpp" | "cxx" | "h" | "hh" | "hpp" | "hxx" => "C/C++",
        "cs" => "C#",
        "rb" => "Ruby",
        "php" => "PHP",
        "swift" => "Swift",
        "m" | "mm" => "Objective-C",
        "sh" | "bash" | "zsh" | "fish" => "Shell",
        "lua" => "Lua",
        "pl" => "Perl",
        "r" => "R",
        "ex" | "exs" => "Elixir",
        "dart" => "Dart",
        "vue" => "Vue",
        "svelte" => "Svelte",
        "html" | "htm" => "HTML",
        "css" | "scss" | "sass" | "less" => "CSS",
        "json" | "jsonc" => "JSON",
        "yaml" | "yml" => "YAML",
        "toml" => "TOML",
        "xml" => "XML",
        "md" | "mdx" => "Markdown",
        "sql" => "SQL",
        "gradle" | "groovy" => "Groovy",
        "tf" => "Terraform",
        _ => "Other",
    }
}

pub(crate) fn parse_ts(value: &Value) -> Option<i64> {
    if let Some(n) = value.as_i64() {
        return Some(if n > 1_000_000_000_000 { n } else { n * 1000 });
    }
    if let Some(n) = value.as_f64() {
        let n = n as i64;
        return Some(if n > 1_000_000_000_000 { n } else { n * 1000 });
    }
    if let Some(s) = value.as_str() {
        return chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.timestamp_millis());
    }
    None
}

pub(crate) fn count_newlines(s: &str) -> u64 {
    s.bytes().filter(|b| *b == b'\n').count() as u64
}

pub fn compute_stats_filtered(project: Option<&str>) -> CodeStats {
    let all = scan_all_sessions();

    let filtered: Vec<&SessionStat> = match project {
        Some(p) => all
            .iter()
            .filter(|s| s.cwd.as_deref() == Some(p))
            .collect(),
        None => all.iter().collect(),
    };

    aggregate_refs(&filtered)
}

pub fn compute_overview(project: Option<&str>, from_ms: i64, to_ms: i64) -> Overview {
    let all = scan_all_sessions();
    let filtered: Vec<&SessionStat> = match project {
        Some(p) => all
            .iter()
            .filter(|s| s.cwd.as_deref() == Some(p))
            .collect(),
        None => all.iter().collect(),
    };
    compute_overview_from(&filtered, from_ms, to_ms, project)
}

fn compute_overview_from(
    filtered: &[&SessionStat],
    from_ms: i64,
    to_ms: i64,
    project: Option<&str>,
) -> Overview {
    let range_len = to_ms - from_ms;
    let prev_from_ms = from_ms - range_len - 1;
    let prev_to_ms = from_ms - 1;

    let mut current_loc: u64 = 0;
    let mut previous_loc: u64 = 0;
    let mut current_files: HashSet<String> = HashSet::new();
    let mut previous_files: HashSet<String> = HashSet::new();

    let mut bucket_loc: HashMap<String, u64> = HashMap::new();
    let mut bucket_files: HashMap<String, HashSet<String>> = HashMap::new();

    let mut model_loc: HashMap<String, u64> = HashMap::new();
    let mut model_files: HashMap<String, HashSet<String>> = HashMap::new();

    let mut lang_loc: HashMap<String, u64> = HashMap::new();
    let mut lang_files: HashMap<String, HashSet<String>> = HashMap::new();
    let mut lang_ext: HashMap<String, String> = HashMap::new();

    let mut session_count: u64 = 0;
    for session in filtered {
        // Sessions with no known model are still counted in totals but excluded
        // from the model breakdown (so "未知" / "<synthetic>" buckets don't appear).
        let model_key: Option<&str> = session.model.as_deref();
        let mut session_in_current = false;
        for event in &session.events {
            let ts = match event.timestamp_ms.or(session.last_active_at) {
                Some(v) => v,
                None => continue,
            };
            let delta = event.added + event.removed;
            if ts >= from_ms && ts <= to_ms {
                current_loc += delta;
                if let Some(fp) = &event.file_path {
                    current_files.insert(fp.clone());
                }
                let date = local_date_key(ts);
                *bucket_loc.entry(date.clone()).or_default() += delta;
                if let Some(fp) = &event.file_path {
                    bucket_files
                        .entry(date)
                        .or_default()
                        .insert(fp.clone());
                }
                if let Some(mk) = model_key {
                    *model_loc.entry(mk.to_string()).or_default() += delta;
                    if let Some(fp) = &event.file_path {
                        model_files
                            .entry(mk.to_string())
                            .or_default()
                            .insert(fp.clone());
                    }
                }
                if let Some(fp) = &event.file_path {
                    let ext = Path::new(fp)
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|s| s.to_lowercase())
                        .unwrap_or_default();
                    let language = ext_to_language(&ext).to_string();
                    *lang_loc.entry(language.clone()).or_default() += delta;
                    lang_files
                        .entry(language.clone())
                        .or_default()
                        .insert(fp.clone());
                    lang_ext.entry(language).or_insert(ext);
                }
                session_in_current = true;
            } else if ts >= prev_from_ms && ts < from_ms && ts <= prev_to_ms {
                previous_loc += delta;
                if let Some(fp) = &event.file_path {
                    previous_files.insert(fp.clone());
                }
            }
        }
        if session_in_current {
            session_count += 1;
        }
    }

    let daily = build_daily_series(from_ms, to_ms, &bucket_loc, &bucket_files);

    let by_model = build_model_breakdown(&model_loc, &model_files, current_loc);
    let by_language = build_language_breakdown(&lang_loc, &lang_files, &lang_ext, current_loc);

    let loc_delta_percent = if previous_loc == 0 {
        None
    } else {
        Some((current_loc as f64 - previous_loc as f64) / previous_loc as f64 * 100.0)
    };
    let files_delta_percent = if previous_files.is_empty() {
        None
    } else {
        Some(
            (current_files.len() as f64 - previous_files.len() as f64)
                / previous_files.len() as f64
                * 100.0,
        )
    };

    let total_project_loc: u64 = match project {
        Some(p) => project_loc::count_loc(Path::new(p)),
        None => {
            let mut roots: HashSet<&str> = HashSet::new();
            for s in filtered.iter() {
                if let Some(cwd) = s.cwd.as_deref() {
                    roots.insert(cwd);
                }
            }
            roots
                .into_iter()
                .map(|r| project_loc::count_loc(Path::new(r)))
                .sum()
        }
    };

    let (ai_ratio_percent, ai_ratio_delta_percent) = if total_project_loc > 0 {
        let cur = (current_loc as f64) / (total_project_loc as f64) * 100.0;
        let prev = (previous_loc as f64) / (total_project_loc as f64) * 100.0;
        (cur, Some(cur - prev))
    } else {
        (0.0, None)
    };

    Overview {
        total_loc: current_loc,
        total_files: current_files.len() as u64,
        loc_delta_percent,
        files_delta_percent,
        daily,
        by_model,
        by_language,
        session_count,
        range_from_ms: from_ms,
        range_to_ms: to_ms,
        total_project_loc,
        ai_ratio_percent,
        ai_ratio_delta_percent,
    }
}

pub fn compute_heatmap(project: Option<&str>, from_ms: i64, to_ms: i64) -> HeatmapData {
    let all = scan_all_sessions();
    let filtered: Vec<&SessionStat> = match project {
        Some(p) => all
            .iter()
            .filter(|s| s.cwd.as_deref() == Some(p))
            .collect(),
        None => all.iter().collect(),
    };

    let mut bucket_loc: HashMap<String, u64> = HashMap::new();
    for session in &filtered {
        for event in &session.events {
            let ts = match event.timestamp_ms.or(session.last_active_at) {
                Some(v) => v,
                None => continue,
            };
            if ts < from_ms || ts > to_ms {
                continue;
            }
            let delta = event.added + event.removed;
            let date = local_date_key(ts);
            *bucket_loc.entry(date).or_default() += delta;
        }
    }

    let start_dt = match Local.timestamp_millis_opt(from_ms).single() {
        Some(v) => v.date_naive(),
        None => {
            return HeatmapData {
                from_ms,
                to_ms,
                cells: Vec::new(),
            }
        }
    };
    let end_dt = match Local.timestamp_millis_opt(to_ms).single() {
        Some(v) => v.date_naive(),
        None => {
            return HeatmapData {
                from_ms,
                to_ms,
                cells: Vec::new(),
            }
        }
    };

    let mut cells = Vec::new();
    let mut cursor = start_dt;
    while cursor <= end_dt {
        let key = cursor.format("%Y-%m-%d").to_string();
        let loc = bucket_loc.get(&key).copied().unwrap_or(0);
        cells.push(HeatmapCell { date: key, loc });
        cursor += ChronoDuration::days(1);
    }

    HeatmapData {
        from_ms,
        to_ms,
        cells,
    }
}

fn local_date_key(ts_ms: i64) -> String {
    match Local.timestamp_millis_opt(ts_ms).single() {
        Some(dt) => dt.format("%Y-%m-%d").to_string(),
        None => "unknown".to_string(),
    }
}

fn build_daily_series(
    from_ms: i64,
    to_ms: i64,
    bucket_loc: &HashMap<String, u64>,
    bucket_files: &HashMap<String, HashSet<String>>,
) -> Vec<DailyBucket> {
    let start_dt = match Local.timestamp_millis_opt(from_ms).single() {
        Some(v) => v.date_naive(),
        None => return Vec::new(),
    };
    let end_dt = match Local.timestamp_millis_opt(to_ms).single() {
        Some(v) => v.date_naive(),
        None => return Vec::new(),
    };
    let mut out = Vec::new();
    let mut cursor = start_dt;
    while cursor <= end_dt {
        let key = cursor.format("%Y-%m-%d").to_string();
        let loc = bucket_loc.get(&key).copied().unwrap_or(0);
        let files = bucket_files
            .get(&key)
            .map(|s| s.len() as u64)
            .unwrap_or(0);
        out.push(DailyBucket { date: key, loc, files });
        cursor += ChronoDuration::days(1);
    }
    out
}

fn build_language_breakdown(
    lang_loc: &HashMap<String, u64>,
    lang_files: &HashMap<String, HashSet<String>>,
    lang_ext: &HashMap<String, String>,
    total_loc: u64,
) -> Vec<LanguageBreakdown> {
    if total_loc == 0 {
        return Vec::new();
    }
    let mut entries: Vec<(String, String, u64, u32)> = lang_loc
        .iter()
        .map(|(language, loc)| {
            let file_count = lang_files
                .get(language)
                .map(|s| s.len() as u32)
                .unwrap_or(0);
            let extension = lang_ext.get(language).cloned().unwrap_or_default();
            (language.clone(), extension, *loc, file_count)
        })
        .collect();
    entries.sort_by_key(|e| std::cmp::Reverse(e.2));

    let total_loc_f = total_loc as f64;
    entries
        .into_iter()
        .map(|(language, extension, loc, file_count)| LanguageBreakdown {
            language,
            extension,
            loc,
            file_count,
            percent: loc as f64 / total_loc_f * 100.0,
        })
        .collect()
}

fn build_model_breakdown(
    model_loc: &HashMap<String, u64>,
    model_files: &HashMap<String, HashSet<String>>,
    total_loc: u64,
) -> Vec<ModelBreakdown> {
    if total_loc == 0 {
        return Vec::new();
    }
    let mut entries: Vec<(String, u64, u64)> = model_loc
        .iter()
        .map(|(model, loc)| {
            let file_count = model_files
                .get(model)
                .map(|s| s.len() as u64)
                .unwrap_or(0);
            (model.clone(), *loc, file_count)
        })
        .collect();
    entries.sort_by_key(|e| std::cmp::Reverse(e.1));

    let total_loc_f = total_loc as f64;
    let result: Vec<ModelBreakdown> = entries
        .into_iter()
        .map(|(model, loc, file_count)| ModelBreakdown {
            model,
            loc,
            file_count,
            percent: loc as f64 / total_loc_f * 100.0,
        })
        .collect();
    result
}

pub fn list_projects() -> Vec<ProjectInfo> {
    let all = scan_all_sessions();
    // (session_count, last_active_at, added, removed)
    let mut by_path: HashMap<String, (u64, Option<i64>, u64, u64)> = HashMap::new();
    for session in &all {
        let key = session.cwd.clone().unwrap_or_else(|| "unknown".to_string());
        let entry = by_path.entry(key).or_insert((0, None, 0, 0));
        entry.0 += 1;
        match (entry.1, session.last_active_at) {
            (None, Some(ts)) => entry.1 = Some(ts),
            (Some(prev), Some(ts)) if ts > prev => entry.1 = Some(ts),
            _ => {}
        }
        for event in &session.events {
            entry.2 += event.added;
            entry.3 += event.removed;
        }
    }
    let mut projects: Vec<ProjectInfo> = by_path
        .into_iter()
        .map(|(path, (session_count, last_active_at, added, removed))| {
            let added_i = i64::try_from(added).unwrap_or(i64::MAX);
            let removed_i = i64::try_from(removed).unwrap_or(i64::MAX);
            ProjectInfo {
                path,
                session_count,
                last_active_at,
                net_loc: added_i.saturating_sub(removed_i),
            }
        })
        .collect();
    projects.sort_by(|a, b| {
        b.last_active_at
            .unwrap_or(0)
            .cmp(&a.last_active_at.unwrap_or(0))
            .then_with(|| b.session_count.cmp(&a.session_count))
    });
    projects
}

fn scan_all_sessions() -> Vec<SessionStat> {
    let (claude_stats, codex_stats) = std::thread::scope(|s| {
        let h1 = s.spawn(claude::scan_all);
        let h2 = s.spawn(codex::scan_all);
        (
            h1.join().unwrap_or_default(),
            h2.join().unwrap_or_default(),
        )
    });

    let mut all = Vec::with_capacity(claude_stats.len() + codex_stats.len());
    all.extend(claude_stats);
    all.extend(codex_stats);
    all
}

fn aggregate_refs(sessions: &[&SessionStat]) -> CodeStats {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let week_cutoff = now_ms - 7 * 24 * 60 * 60 * 1000;
    let month_cutoff = now_ms - 30 * 24 * 60 * 60 * 1000;

    let mut total = LocDelta::default();
    let mut by_provider: HashMap<String, LocDelta> = HashMap::new();
    let mut by_project: HashMap<String, LocDelta> = HashMap::new();
    let mut file_map: HashMap<(String, String), LocDelta> = HashMap::new();
    let mut this_week = LocDelta::default();
    let mut this_month = LocDelta::default();

    for session in sessions {
        let project_key = session.cwd.clone().unwrap_or_else(|| "unknown".to_string());
        for event in &session.events {
            total.accumulate(event.added, event.removed);
            by_provider
                .entry(session.provider.clone())
                .or_default()
                .accumulate(event.added, event.removed);
            by_project
                .entry(project_key.clone())
                .or_default()
                .accumulate(event.added, event.removed);

            if let Some(path) = &event.file_path {
                file_map
                    .entry((path.clone(), session.provider.clone()))
                    .or_default()
                    .accumulate(event.added, event.removed);
            }

            let ts = event.timestamp_ms.or(session.last_active_at);
            if let Some(ts) = ts {
                if ts >= week_cutoff {
                    this_week.accumulate(event.added, event.removed);
                }
                if ts >= month_cutoff {
                    this_month.accumulate(event.added, event.removed);
                }
            }
        }
    }

    let mut top_files: Vec<FileLoc> = file_map
        .into_iter()
        .map(|((path, provider), delta)| FileLoc {
            path,
            delta,
            provider,
        })
        .collect();
    top_files.sort_by(|a, b| {
        let a_net = a.delta.added + a.delta.removed;
        let b_net = b.delta.added + b.delta.removed;
        b_net.cmp(&a_net)
    });
    top_files.truncate(10);

    CodeStats {
        total,
        by_provider,
        by_project,
        top_files,
        this_week,
        this_month,
        session_count: sessions.len() as u64,
    }
}

pub(crate) fn collect_jsonl_files(root: &Path, files: &mut Vec<PathBuf>) {
    if !root.exists() {
        return;
    }
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregate_groups_by_provider_project_and_window() {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let yesterday = now_ms - 24 * 60 * 60 * 1000;
        let two_months_ago = now_ms - 60 * 24 * 60 * 60 * 1000;

        let sessions = vec![
            SessionStat {
                provider: "claude".to_string(),
                cwd: Some("/p/alpha".to_string()),
                last_active_at: Some(yesterday),
                model: None,
                events: vec![EditEvent {
                    file_path: Some("a.rs".to_string()),
                    timestamp_ms: Some(yesterday),
                    added: 10,
                    removed: 2,
                }],
            },
            SessionStat {
                provider: "codex".to_string(),
                cwd: Some("/p/beta".to_string()),
                last_active_at: Some(yesterday),
                model: None,
                events: vec![EditEvent {
                    file_path: Some("b.rs".to_string()),
                    timestamp_ms: Some(yesterday),
                    added: 5,
                    removed: 1,
                }],
            },
            SessionStat {
                provider: "claude".to_string(),
                cwd: Some("/p/alpha".to_string()),
                last_active_at: Some(two_months_ago),
                model: None,
                events: vec![EditEvent {
                    file_path: Some("c.rs".to_string()),
                    timestamp_ms: Some(two_months_ago),
                    added: 100,
                    removed: 50,
                }],
            },
        ];

        let refs: Vec<&SessionStat> = sessions.iter().collect();
        let stats = aggregate_refs(&refs);
        assert_eq!(stats.total.added, 115);
        assert_eq!(stats.total.removed, 53);
        assert_eq!(stats.by_provider.get("claude").unwrap().added, 110);
        assert_eq!(stats.by_provider.get("codex").unwrap().added, 5);
        assert_eq!(stats.by_project.get("/p/alpha").unwrap().added, 110);
        assert_eq!(stats.by_project.get("/p/beta").unwrap().added, 5);
        assert_eq!(stats.this_week.added, 15);
        assert_eq!(stats.this_week.removed, 3);
        assert_eq!(stats.this_month.added, 15);
        assert_eq!(stats.session_count, 3);
        assert!(!stats.top_files.is_empty());
    }

    #[test]
    fn aggregate_refs_with_project_filter_drops_other_projects() {
        let sessions = vec![
            SessionStat {
                provider: "claude".to_string(),
                cwd: Some("/p/alpha".to_string()),
                last_active_at: Some(0),
                model: None,
                events: vec![EditEvent {
                    file_path: Some("a.rs".to_string()),
                    timestamp_ms: Some(0),
                    added: 10,
                    removed: 0,
                }],
            },
            SessionStat {
                provider: "codex".to_string(),
                cwd: Some("/p/beta".to_string()),
                last_active_at: Some(0),
                model: None,
                events: vec![EditEvent {
                    file_path: Some("b.rs".to_string()),
                    timestamp_ms: Some(0),
                    added: 99,
                    removed: 0,
                }],
            },
        ];

        let only_alpha: Vec<&SessionStat> =
            sessions.iter().filter(|s| s.cwd.as_deref() == Some("/p/alpha")).collect();
        let stats = aggregate_refs(&only_alpha);
        assert_eq!(stats.total.added, 10);
        assert_eq!(stats.session_count, 1);
        assert!(stats.by_project.get("/p/beta").is_none());
        assert!(stats.by_provider.get("codex").is_none());
    }

    #[test]
    fn count_newlines_basic() {
        assert_eq!(count_newlines(""), 0);
        assert_eq!(count_newlines("abc"), 0);
        assert_eq!(count_newlines("a\nb\n"), 2);
        assert_eq!(count_newlines("\n\n\n"), 3);
    }

    fn local_ms_for(date: chrono::NaiveDate, h: u32, m: u32) -> i64 {
        let dt = date.and_hms_opt(h, m, 0).expect("valid time");
        Local
            .from_local_datetime(&dt)
            .single()
            .expect("unambiguous local time")
            .timestamp_millis()
    }

    #[test]
    fn compute_overview_buckets_by_local_day() {
        let day1 = chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let day2 = chrono::NaiveDate::from_ymd_opt(2026, 1, 2).unwrap();
        let day4 = chrono::NaiveDate::from_ymd_opt(2026, 1, 4).unwrap();
        let from_ms = local_ms_for(day1, 0, 0);
        let to_ms = local_ms_for(day4, 23, 59);

        let session = SessionStat {
            provider: "claude".to_string(),
            cwd: Some("/p/alpha".to_string()),
            last_active_at: Some(local_ms_for(day4, 12, 0)),
            model: Some("claude-opus-4-7".to_string()),
            events: vec![
                EditEvent {
                    file_path: Some("a.rs".to_string()),
                    timestamp_ms: Some(local_ms_for(day1, 10, 0)),
                    added: 5,
                    removed: 1,
                },
                EditEvent {
                    file_path: Some("b.rs".to_string()),
                    timestamp_ms: Some(local_ms_for(day2, 11, 0)),
                    added: 7,
                    removed: 3,
                },
                EditEvent {
                    file_path: Some("c.rs".to_string()),
                    timestamp_ms: Some(local_ms_for(day4, 14, 0)),
                    added: 2,
                    removed: 0,
                },
            ],
        };

        let refs: Vec<&SessionStat> = vec![&session];
        let overview = compute_overview_from(&refs, from_ms, to_ms, None);
        assert_eq!(overview.daily.len(), 4);
        assert_eq!(overview.daily[0].date, "2026-01-01");
        assert_eq!(overview.daily[0].loc, 6);
        assert_eq!(overview.daily[0].files, 1);
        assert_eq!(overview.daily[1].date, "2026-01-02");
        assert_eq!(overview.daily[1].loc, 10);
        assert_eq!(overview.daily[1].files, 1);
        assert_eq!(overview.daily[2].date, "2026-01-03");
        assert_eq!(overview.daily[2].loc, 0);
        assert_eq!(overview.daily[2].files, 0);
        assert_eq!(overview.daily[3].date, "2026-01-04");
        assert_eq!(overview.daily[3].loc, 2);
        assert_eq!(overview.daily[3].files, 1);
        assert_eq!(overview.total_loc, 18);
        assert_eq!(overview.total_files, 3);
        assert_eq!(overview.session_count, 1);
    }

    #[test]
    fn compute_overview_period_over_period_delta() {
        let cur_day = chrono::NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        let from_ms = local_ms_for(cur_day, 0, 0);
        let to_ms = local_ms_for(cur_day, 23, 59);
        let range_len = to_ms - from_ms;
        let prev_day_ts = from_ms - range_len / 2;

        let session = SessionStat {
            provider: "claude".to_string(),
            cwd: Some("/p/a".to_string()),
            last_active_at: Some(local_ms_for(cur_day, 12, 0)),
            model: None,
            events: vec![
                EditEvent {
                    file_path: Some("cur.rs".to_string()),
                    timestamp_ms: Some(local_ms_for(cur_day, 12, 0)),
                    added: 60,
                    removed: 40,
                },
                EditEvent {
                    file_path: Some("prev.rs".to_string()),
                    timestamp_ms: Some(prev_day_ts),
                    added: 30,
                    removed: 20,
                },
            ],
        };
        let refs: Vec<&SessionStat> = vec![&session];
        let overview = compute_overview_from(&refs, from_ms, to_ms, None);
        assert_eq!(overview.total_loc, 100);
        assert_eq!(overview.loc_delta_percent, Some(100.0));

        let zero_session = SessionStat {
            provider: "claude".to_string(),
            cwd: Some("/p/a".to_string()),
            last_active_at: Some(local_ms_for(cur_day, 12, 0)),
            model: None,
            events: vec![EditEvent {
                file_path: Some("cur.rs".to_string()),
                timestamp_ms: Some(local_ms_for(cur_day, 12, 0)),
                added: 60,
                removed: 40,
            }],
        };
        let refs2: Vec<&SessionStat> = vec![&zero_session];
        let overview2 = compute_overview_from(&refs2, from_ms, to_ms, None);
        assert_eq!(overview2.total_loc, 100);
        assert_eq!(overview2.loc_delta_percent, None);
        assert_eq!(overview2.files_delta_percent, None);
    }

    #[test]
    fn compute_overview_returns_all_models_sorted_desc_by_loc() {
        let day = chrono::NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let from_ms = local_ms_for(day, 0, 0);
        let to_ms = local_ms_for(day, 23, 59);
        let ts = local_ms_for(day, 12, 0);

        let models = [
            ("m1", 100),
            ("m2", 80),
            ("m3", 60),
            ("m4", 40),
            ("m5", 20),
            ("m6", 10),
        ];
        let sessions: Vec<SessionStat> = models
            .iter()
            .enumerate()
            .map(|(i, (m, loc))| SessionStat {
                provider: "claude".to_string(),
                cwd: Some("/p/x".to_string()),
                last_active_at: Some(ts),
                model: Some((*m).to_string()),
                events: vec![EditEvent {
                    file_path: Some(format!("f{}.rs", i)),
                    timestamp_ms: Some(ts),
                    added: *loc as u64,
                    removed: 0,
                }],
            })
            .collect();
        let refs: Vec<&SessionStat> = sessions.iter().collect();
        let overview = compute_overview_from(&refs, from_ms, to_ms, None);
        assert_eq!(overview.by_model.len(), 6);
        assert_eq!(overview.by_model[0].model, "m1");
        assert_eq!(overview.by_model[1].model, "m2");
        assert_eq!(overview.by_model[2].model, "m3");
        assert_eq!(overview.by_model[3].model, "m4");
        assert_eq!(overview.by_model[4].model, "m5");
        assert_eq!(overview.by_model[5].model, "m6");
    }

    #[test]
    fn compute_overview_respects_project_filter() {
        let day = chrono::NaiveDate::from_ymd_opt(2026, 4, 1).unwrap();
        let from_ms = local_ms_for(day, 0, 0);
        let to_ms = local_ms_for(day, 23, 59);
        let ts = local_ms_for(day, 12, 0);

        let s1 = SessionStat {
            provider: "claude".to_string(),
            cwd: Some("/p/alpha".to_string()),
            last_active_at: Some(ts),
            model: None,
            events: vec![EditEvent {
                file_path: Some("a.rs".to_string()),
                timestamp_ms: Some(ts),
                added: 50,
                removed: 0,
            }],
        };
        let s2 = SessionStat {
            provider: "codex".to_string(),
            cwd: Some("/p/beta".to_string()),
            last_active_at: Some(ts),
            model: None,
            events: vec![EditEvent {
                file_path: Some("b.rs".to_string()),
                timestamp_ms: Some(ts),
                added: 999,
                removed: 0,
            }],
        };
        let all = vec![s1, s2];
        let filtered: Vec<&SessionStat> = all
            .iter()
            .filter(|s| s.cwd.as_deref() == Some("/p/alpha"))
            .collect();
        let overview = compute_overview_from(&filtered, from_ms, to_ms, None);
        assert_eq!(overview.total_loc, 50);
        assert_eq!(overview.session_count, 1);
    }

    #[test]
    fn compute_overview_exposes_project_loc_and_ai_ratio() {
        use std::fs::{self, File};
        use std::io::Write;
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("src")).unwrap();
        let mut f = File::create(root.join("src/a.ts")).unwrap();
        let mut content = String::new();
        for i in 0..100 {
            content.push_str(&format!("line {}\n", i));
        }
        f.write_all(content.as_bytes()).unwrap();

        let day = chrono::NaiveDate::from_ymd_opt(2026, 5, 1).unwrap();
        let from_ms = local_ms_for(day, 0, 0);
        let to_ms = local_ms_for(day, 23, 59);
        let ts = local_ms_for(day, 12, 0);
        let project_path = root.to_string_lossy().to_string();

        let s = SessionStat {
            provider: "claude".to_string(),
            cwd: Some(project_path.clone()),
            last_active_at: Some(ts),
            model: None,
            events: vec![EditEvent {
                file_path: Some("a.ts".to_string()),
                timestamp_ms: Some(ts),
                added: 25,
                removed: 0,
            }],
        };
        let refs: Vec<&SessionStat> = vec![&s];
        let overview =
            compute_overview_from(&refs, from_ms, to_ms, Some(project_path.as_str()));
        assert_eq!(overview.total_project_loc, 100);
        assert!((overview.ai_ratio_percent - 25.0).abs() < 0.0001);
        assert!(overview.ai_ratio_delta_percent.is_some());
    }

    #[test]
    fn parse_ts_handles_int_and_rfc3339() {
        assert_eq!(
            parse_ts(&serde_json::json!(1_771_061_953_033i64)),
            Some(1_771_061_953_033)
        );
        assert_eq!(
            parse_ts(&serde_json::json!(1_771_061_953i64)),
            Some(1_771_061_953_000)
        );
        assert_eq!(
            parse_ts(&serde_json::json!("1970-01-01T00:00:01Z")),
            Some(1_000)
        );
    }
}
