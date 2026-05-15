# Spec v3 — Total Project LOC + AI Ratio cards

**Target:** `/Users/liuxing/Desktop/cccode` (current dir)
**User goal:** add two metric cards to the 概况 page top row.

Final top row = 4 cards (purple / blue / orange / green):

| # | Title (zh) | Value | Color/Icon | Delta |
|---|---|---|---|---|
| 1 | 总代码数 | total LOC of the project workspace (filesystem scan) | purple, Lucide `Layers` | "—" (no period delta in v1) |
| 2 | 生成代码行数 (existing) | `overview.totalLoc` | blue, Lucide `Code2` | `overview.locDeltaPercent` |
| 3 | AI 生成代码占比 | `currentLoc / totalProjectLoc * 100` formatted "X.XX%" | orange, Lucide `PieChart` | absolute percentage-point delta (`current_ratio - previous_ratio`), formatted with same arrow style |
| 4 | 生成文件数量 (existing) | `overview.totalFiles` | green, Lucide `FileText` | `overview.filesDeltaPercent` |

Cards keep the existing sparkline (small area chart) layout.

---

## Backend (Rust) — must do

### 1. New module `src-tauri/src/code_stats/project_loc.rs`

Recursive directory walker that counts newlines in text-source files.

```rust
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;
use once_cell::sync::Lazy;

const SOURCE_EXTENSIONS: &[&str] = &[
    "rs","ts","tsx","js","jsx","mjs","cjs","py","go","java","kt","kts","scala",
    "c","cc","cpp","cxx","h","hh","hpp","hxx","cs","rb","php","swift","m","mm",
    "sh","bash","zsh","fish","lua","pl","r","ex","exs","dart","vue","svelte",
    "html","htm","css","scss","sass","less","json","jsonc","yaml","yml","toml",
    "xml","md","mdx","sql","gradle","groovy","tf",
];

const SKIP_DIRS: &[&str] = &[
    "node_modules","target","dist","build",".git",".next",".turbo",".pnpm",
    "vendor","coverage","__pycache__",".venv","venv","env",".idea",".vscode",
    ".gradle",".mvn","out","bin","obj",".cache",".nx",".parcel-cache",
];

const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024; // 5 MB cap per file

#[derive(Clone)]
struct CacheEntry {
    root_mtime: SystemTime,
    loc: u64,
}

static CACHE: Lazy<Mutex<HashMap<PathBuf, CacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn count_loc(path: &Path) -> u64 {
    // 1. Fast path: cache hit if top-level mtime unchanged
    let Ok(meta) = std::fs::metadata(path) else { return 0; };
    let Ok(root_mtime) = meta.modified() else { return 0; };
    if let Ok(cache) = CACHE.lock() {
        if let Some(entry) = cache.get(path) {
            if entry.root_mtime == root_mtime {
                return entry.loc;
            }
        }
    }
    // 2. Walk and count
    let loc = walk_and_count(path);
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(path.to_path_buf(), CacheEntry { root_mtime, loc });
    }
    loc
}

fn walk_and_count(root: &Path) -> u64 { /* recursive impl */ }
fn count_newlines_in_file(path: &Path) -> Option<u64> { /* read + byte filter */ }
```

Implementation notes:
- Use `std::fs::read_dir`; ignore symlinks (skip if `metadata.is_symlink()`).
- Skip a directory if its file name (lowercased) is in `SKIP_DIRS`, or starts with `.` *unless* in a small allow-list (`.github`, `.config`).
- Only count regular files with extension in `SOURCE_EXTENSIONS` (lowercased).
- Skip files larger than `MAX_FILE_BYTES`.
- Count newlines via `BufReader::read_until(b'\n')` loop or `bytes().filter(|b| *b == b'\n').count()` for small files. Don't load full file to String.
- Handle errors silently (skip the bad entry, continue) — never panic.

Tests required:
- `count_loc_skips_node_modules` — fixture with `src/a.ts` (3 lines) + `node_modules/x.ts` (100 lines) → expect 3
- `count_loc_counts_only_whitelisted_extensions` — fixture with `app.py` (5 lines) + `binary.bin` (1MB) + `README.md` (10 lines) → expect 15 (.bin not counted, .py and .md counted)
- `count_loc_skips_dot_dirs_except_allowlist` — fixture with `.git/foo.ts` (50 lines) + `src/a.ts` (3 lines) → expect 3
- `count_loc_cache_returns_same_result_on_unchanged_mtime` — call twice, second hit should match (this is hard to test without mtime manipulation; can skip if too fiddly)

### 2. Wire into `code_stats/mod.rs`

Add to module list:
```rust
pub mod project_loc;
```

Add fields to `Overview` struct (camelCase serde already on):
```rust
pub total_project_loc: u64,
pub ai_ratio_percent: f64,           // 0-100
pub ai_ratio_delta_percent: Option<f64>, // absolute pp delta vs previous window
```

Inside `compute_overview` (after current_loc and previous_loc are accumulated):
```rust
let total_project_loc: u64 = match project {
    Some(p) => project_loc::count_loc(Path::new(p)),
    None => {
        // Sum over all distinct cwds present in the filtered sessions
        let mut roots: HashSet<&str> = HashSet::new();
        for s in filtered.iter() {
            if let Some(cwd) = s.cwd.as_deref() { roots.insert(cwd); }
        }
        roots.into_iter().map(|r| project_loc::count_loc(Path::new(r))).sum()
    }
};

let (ai_ratio_percent, ai_ratio_delta_percent) = if total_project_loc > 0 {
    let cur = (current_loc as f64) / (total_project_loc as f64) * 100.0;
    let prev = (previous_loc as f64) / (total_project_loc as f64) * 100.0;
    (cur, Some(cur - prev))
} else {
    (0.0, None)
};
```

### 3. Test for the integration

`compute_overview_exposes_project_loc_and_ai_ratio` — use a tempdir as project path; create a sample `.ts` file with 100 lines; build a SessionStat with cwd set to that path + an EditEvent that adds 25 lines in current window. Assert `total_project_loc == 100`, `ai_ratio_percent ~= 25.0`.

### Done criteria — backend

```bash
. ~/.cargo/env && (cd /Users/liuxing/Desktop/cccode/src-tauri && cargo check)        # exit 0
. ~/.cargo/env && (cd /Users/liuxing/Desktop/cccode/src-tauri && cargo test --lib)   # 14 existing + ~4 new ≥ 18 tests
```

---

## Frontend (TypeScript) — must do

### 1. Extend `src/types.ts`

```ts
export interface Overview {
  totalLoc: number;
  totalFiles: number;
  locDeltaPercent: number | null;
  filesDeltaPercent: number | null;
  daily: DailyBucket[];
  byModel: ModelBreakdown[];
  sessionCount: number;
  rangeFromMs: number;
  rangeToMs: number;
  totalProjectLoc: number;          // NEW
  aiRatioPercent: number;           // NEW
  aiRatioDeltaPercent: number | null; // NEW
}
```

### 2. Grid + new cards in `src/components/overview/OverviewPage.tsx`

Change the metric cards grid:
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
```

Add the new cards. Place 总代码数 first, AI 占比 third (between blue and green) to match mockup order.

Use the existing `MetricCard` component. **It currently formats integer values** — extend it (or add a sibling variant) so percentages render as `"3.34%"` with 2-decimal precision, and delta uses absolute pp instead of % when it's already a ratio.

Cleanest: add an optional `valueFormatter?: (n: number) => string` and `deltaFormatter?: (n: number) => string` prop to `MetricCard`. Existing callers continue to work (default = `formatNumber` and "X.X%").

For sparklines on 总代码数 and AI 占比: reuse `overview.daily` but compute different series. Acceptable v1:
- 总代码数 sparkline: use `bucket.loc` (same as 生成代码行数). It's an approximation but visually communicates trend.
- AI 占比 sparkline: also use `bucket.loc` for v1.
- A future v2 can compute proper per-day project-LOC + ratio.

Note this approximation in a code comment so reviewers don't think it's a bug.

Icons:
- 总代码数: `Layers` from `lucide-react`, color `text-purple-600`, bg `bg-purple-50 dark:bg-purple-950/40`
- AI 占比: `PieChart` from `lucide-react`, color `text-orange-600`, bg `bg-orange-50 dark:bg-orange-950/40`

### Done criteria — frontend

```bash
cd /Users/liuxing/Desktop/cccode && pnpm tsc --noEmit  # exit 0
```

---

## Global done

- Backend: cargo check + cargo test --lib pass
- Frontend: pnpm tsc --noEmit passes
- rusqlite still NOT in Cargo.lock
- 4 cards visible in `OverviewPage` (cargo-check + tsc clean is the proof; do NOT `pnpm tauri dev`)

## Caveats / things NOT in scope

- 总代码数 has no "较上期 X%" — show "—". Computing this needs git archeology or file-mtime sampling; defer.
- "全部项目" mode sums LOC across every known project cwd; first such call can be slow if many huge dirs. The mtime cache makes subsequent calls fast.
- AI 占比 delta is **absolute percentage-point delta** (e.g., 3.34% vs 2.78% → +0.56pp), NOT relative change. Matches the user's mockup.
