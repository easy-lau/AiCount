use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

/// Languages excluded from code-amount statistics by default. Markdown is
/// treated as prose rather than code, so it does not count toward LOC.
fn default_excluded_languages() -> Vec<String> {
    vec!["Markdown".to_string()]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    #[serde(default = "default_excluded_languages")]
    pub excluded_languages: Vec<String>,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            excluded_languages: default_excluded_languages(),
        }
    }
}

static CACHE: Lazy<Mutex<Option<UserSettings>>> = Lazy::new(|| Mutex::new(None));

fn settings_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AICount")
        .join("settings.json")
}

/// Load settings, using an in-memory cache. Falls back to defaults when the
/// file is missing or unreadable.
pub fn load() -> UserSettings {
    let mut guard = CACHE.lock().unwrap();
    if let Some(cached) = guard.as_ref() {
        return cached.clone();
    }
    let loaded = std::fs::read_to_string(settings_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<UserSettings>(&raw).ok())
        .unwrap_or_default();
    *guard = Some(loaded.clone());
    loaded
}

/// Persist settings atomically (temp file + rename) and refresh the cache.
pub fn save(settings: &UserSettings) -> std::io::Result<()> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, &path)?;
    *CACHE.lock().unwrap() = Some(settings.clone());
    Ok(())
}

/// Force the in-memory settings cache to a known value. Tests that exercise
/// stat computations use this so results don't depend on the developer's real
/// `settings.json`.
#[cfg(test)]
pub fn override_for_test(settings: UserSettings) {
    *CACHE.lock().unwrap() = Some(settings);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_excludes_markdown() {
        let s = UserSettings::default();
        assert!(s.excluded_languages.iter().any(|l| l == "Markdown"));
    }

    #[test]
    fn deserializes_missing_field_to_default() {
        let s: UserSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.excluded_languages, vec!["Markdown".to_string()]);
    }
}
