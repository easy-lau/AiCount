use std::collections::HashMap;
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use once_cell::sync::Lazy;

const SOURCE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "java", "kt", "kts", "scala",
    "c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx", "cs", "rb", "php", "swift", "m", "mm",
    "sh", "bash", "zsh", "fish", "lua", "pl", "r", "ex", "exs", "dart", "vue", "svelte",
    "html", "htm", "css", "scss", "sass", "less", "json", "jsonc", "yaml", "yml", "toml",
    "xml", "md", "mdx", "sql", "gradle", "groovy", "tf",
];

const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", "build", ".git", ".next", ".turbo", ".pnpm",
    "vendor", "coverage", "__pycache__", ".venv", "venv", "env", ".idea", ".vscode",
    ".gradle", ".mvn", "out", "bin", "obj", ".cache", ".nx", ".parcel-cache",
];

const DOT_DIR_ALLOWLIST: &[&str] = &[".github", ".config"];

const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Clone)]
struct CacheEntry {
    root_mtime: SystemTime,
    by_language: HashMap<String, u64>,
}

static CACHE: Lazy<Mutex<HashMap<PathBuf, CacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Per-language source-line counts for the project, cached by directory mtime.
/// The breakdown is intentionally unfiltered so the cache stays valid when the
/// user changes which languages are excluded.
pub fn count_loc_by_language(path: &Path) -> HashMap<String, u64> {
    let Ok(meta) = std::fs::metadata(path) else {
        return HashMap::new();
    };
    if !meta.is_dir() {
        return HashMap::new();
    }
    let Ok(root_mtime) = meta.modified() else {
        return HashMap::new();
    };
    if let Ok(cache) = CACHE.lock() {
        if let Some(entry) = cache.get(path) {
            if entry.root_mtime == root_mtime {
                return entry.by_language.clone();
            }
        }
    }
    let skip_set: HashSet<String> = SKIP_DIRS.iter().map(|s| s.to_lowercase()).collect();
    let by_language = walk_and_count(path, &skip_set);
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(
            path.to_path_buf(),
            CacheEntry {
                root_mtime,
                by_language: by_language.clone(),
            },
        );
    }
    by_language
}

fn walk_and_count(root: &Path, skip_set: &HashSet<String>) -> HashMap<String, u64> {
    let mut by_language: HashMap<String, u64> = HashMap::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_symlink() {
                continue;
            }
            if meta.is_dir() {
                let name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_lowercase(),
                    None => continue,
                };
                if skip_set.contains(&name) {
                    continue;
                }
                if name.starts_with('.') && !DOT_DIR_ALLOWLIST.iter().any(|s| *s == name) {
                    continue;
                }
                stack.push(path);
            } else if meta.is_file() {
                if meta.len() > MAX_FILE_BYTES {
                    continue;
                }
                let ext = match path.extension().and_then(|e| e.to_str()) {
                    Some(e) => e.to_lowercase(),
                    None => continue,
                };
                if !SOURCE_EXTENSIONS.iter().any(|s| *s == ext) {
                    continue;
                }
                if let Some(n) = count_newlines_in_file(&path) {
                    *by_language
                        .entry(super::ext_to_language(&ext).to_string())
                        .or_default() += n;
                }
            }
        }
    }
    by_language
}

fn count_newlines_in_file(path: &Path) -> Option<u64> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut count: u64 = 0;
    let mut buf = Vec::with_capacity(8192);
    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf).ok()?;
        if n == 0 {
            break;
        }
        if buf.last() == Some(&b'\n') {
            count += 1;
        }
    }
    Some(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn count_loc(path: &Path) -> u64 {
        count_loc_by_language(path).values().sum()
    }

    fn write_lines(path: &Path, n: usize) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut s = String::new();
        for i in 0..n {
            s.push_str(&format!("line {}\n", i));
        }
        fs::write(path, s).unwrap();
    }

    #[test]
    fn count_loc_skips_node_modules() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_lines(&root.join("src/a.ts"), 3);
        write_lines(&root.join("node_modules/x.ts"), 100);
        assert_eq!(count_loc(root), 3);
    }

    #[test]
    fn count_loc_counts_only_whitelisted_extensions() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_lines(&root.join("app.py"), 5);
        write_lines(&root.join("README.md"), 10);
        fs::write(root.join("binary.bin"), vec![0u8; 16]).unwrap();
        assert_eq!(count_loc(root), 15);
    }

    #[test]
    fn count_loc_skips_dot_dirs_except_allowlist() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_lines(&root.join(".git/foo.ts"), 50);
        write_lines(&root.join("src/a.ts"), 3);
        assert_eq!(count_loc(root), 3);
    }

    #[test]
    fn count_loc_includes_dot_github_allowlist() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_lines(&root.join(".github/workflows/ci.yml"), 7);
        write_lines(&root.join("src/a.ts"), 3);
        assert_eq!(count_loc(root), 10);
    }
}
