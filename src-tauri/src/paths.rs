use std::path::PathBuf;

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

pub fn get_codex_config_dir() -> PathBuf {
    home().join(".codex")
}

pub fn get_claude_config_dir() -> PathBuf {
    home().join(".claude")
}
