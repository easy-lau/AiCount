# UI Redesign Spec — "AI Code Stats" full overview page

**Target:** `/Users/liuxing/Desktop/cccode` (current dir)
**Reference:** the user's mockup — left brand sidebar; 概况 page with date range picker + project dropdown header; 2 metric cards w/ sparklines; trend area chart; model donut + breakdown table.

## Existing state (do not redo)

These already work and must keep passing tests:
- Session list page (`src/components/sessions/`)
- Code stats backend (`src-tauri/src/code_stats/{mod,claude,codex}.rs`) with `compute_stats_filtered` / `list_projects`
- Project dropdown in current Stats page (will be replaced by new design)

## Coordination

Exactly **2 subtasks**. Claim ONE before any work via:
```bash
omc team api list-tasks --input '{"team_name":"<team>"}' --json
omc team api claim-task --input '{"team_name":"<team>","task_id":"<id>","worker_id":"<self>"}' --json
```

Subtask A owns backend files; Subtask B owns frontend files. They do not overlap.

## Data contract (both workers honor this)

```ts
// src/types.ts additions
export interface DailyBucket {
  date: string;           // ISO "YYYY-MM-DD"
  loc: number;            // added + removed for the bucket
  files: number;          // distinct file paths edited in the bucket
}

export interface ModelBreakdown {
  model: string;          // e.g. "claude-opus-4-7", "gpt-5.5", "其他"
  loc: number;            // added + removed
  fileCount: number;
  percent: number;        // 0–100 against current period total
}

export interface Overview {
  totalLoc: number;                // current period added+removed
  totalFiles: number;              // distinct file paths edited in current period
  locDeltaPercent: number | null;  // (current - previous) / previous * 100, null if previous is 0
  filesDeltaPercent: number | null;
  daily: DailyBucket[];            // sorted ascending, one entry per day in range
  byModel: ModelBreakdown[];       // sorted by loc desc; top 4 + "其他"
  sessionCount: number;
  rangeFromMs: number;             // echoed back
  rangeToMs: number;
}

export interface OverviewQuery {
  project?: string;       // unset = all projects
  fromMs: number;         // inclusive
  toMs: number;           // inclusive
}
```

Backend Tauri command: `compute_overview(query: OverviewQuery) -> Overview`

---

## Subtask A — Backend

Owner: `src-tauri/src/code_stats/**`, `src-tauri/src/commands/code_stats.rs`, `src-tauri/src/lib.rs`

### A1. Extend `SessionStat` and `EditEvent`

In `src-tauri/src/code_stats/mod.rs`:

```rust
pub struct EditEvent {
    pub file_path: Option<String>,
    pub timestamp_ms: Option<i64>,
    pub added: u64,
    pub removed: u64,
    // (no new fields here)
}

pub struct SessionStat {
    pub provider: String,
    pub cwd: Option<String>,
    pub events: Vec<EditEvent>,
    pub last_active_at: Option<i64>,
    pub model: Option<String>,   // NEW
}
```

### A2. Extract `model` in providers

`providers/claude.rs`: when iterating jsonl lines, capture the first non-empty `message.model` string. Persist on `SessionStat.model`. Default `None` if absent.

`providers/codex.rs`: parse the first `session_meta` line's `payload.model` (e.g. "gpt-5.5"). Persist on `SessionStat.model`. Default `None`.

### A3. Add `compute_overview`

Add to `src-tauri/src/code_stats/mod.rs`:

```rust
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
pub struct Overview {
    pub total_loc: u64,
    pub total_files: u64,
    pub loc_delta_percent: Option<f64>,
    pub files_delta_percent: Option<f64>,
    pub daily: Vec<DailyBucket>,
    pub by_model: Vec<ModelBreakdown>,
    pub session_count: u64,
    pub range_from_ms: i64,
    pub range_to_ms: i64,
}

pub fn compute_overview(
    project: Option<&str>,
    from_ms: i64,
    to_ms: i64,
) -> Overview { /* ... */ }
```

Implementation notes:
- Reuse `scan_all_sessions()` (already exists)
- Filter sessions by `project` if set (cwd match, same as existing filter)
- For each event in each session, decide:
  - Current window: `from_ms <= ts <= to_ms` → add to current totals
  - Previous window: `(2*from_ms - to_ms - 1) <= ts < from_ms` → add to previous totals
  - Where `range_len = to_ms - from_ms`; previous window = `[from_ms - range_len - 1, from_ms - 1]`
- Daily bucket key: format `ts` as `YYYY-MM-DD` in **local** timezone (use `chrono::Local` since this is a desktop app); fill missing days with zeros so the chart line is continuous
- File count: per bucket, count distinct `file_path` (use `HashSet<&str>` per bucket); for `total_files`, count distinct file paths across all events in current window
- `loc_delta_percent`: if `previous_loc == 0` → `None`; else `(current - previous) as f64 / previous as f64 * 100`. Same for files.
- `by_model`: aggregate per `session.model`, fallback label `"未知"` when `None`. Compute `percent = loc / total_loc * 100`. Sort desc by loc. Keep top 4, collapse remainder into one bucket labeled `"其他"`. If total_loc == 0, return empty Vec.

### A4. Wire Tauri command

In `src-tauri/src/commands/code_stats.rs`, add:

```rust
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewQuery {
    pub project: Option<String>,
    pub from_ms: i64,
    pub to_ms: i64,
}

#[tauri::command]
pub async fn compute_overview(
    query: OverviewQuery,
) -> Result<code_stats::Overview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        code_stats::compute_overview(query.project.as_deref(), query.from_ms, query.to_ms)
    })
    .await
    .map_err(|e| format!("compute_overview failed: {e}"))
}
```

Register in `src-tauri/src/commands/mod.rs` and `src-tauri/src/lib.rs` invoke_handler.

**Keep `compute_code_stats` + `list_projects` working** — they're used by the existing 统计 detail tab.

### A5. Tests

Add to `src-tauri/src/code_stats/mod.rs`:

1. `compute_overview_buckets_by_local_day` — 3 events on 3 distinct days → 3 daily buckets with correct LOC + file counts; gap days filled with zero
2. `compute_overview_period_over_period_delta` — current window 100 loc, previous window 50 loc → `loc_delta_percent == Some(100.0)`; previous window 0 → `None`
3. `compute_overview_groups_by_model_and_collapses_to_others` — 6 distinct models with descending loc → result has 4 individual + 1 "其他"
4. `compute_overview_respects_project_filter` — 2 sessions in different projects → filtered overview sees only one

**Done when:**
```bash
. ~/.cargo/env && (cd /Users/liuxing/Desktop/cccode/src-tauri && cargo check)        # exit 0
. ~/.cargo/env && (cd /Users/liuxing/Desktop/cccode/src-tauri && cargo test --lib)   # all pass (existing 10 + new 4 = 14)
```

---

## Subtask B — Frontend

Owner: `src/App.tsx`, `src/components/overview/**` (new), `src/components/sidebar/**` (new), `src/components/stats/StatsPage.tsx` (no breaking changes), `src/types.ts` (additions only), `package.json` (add deps)

### B1. Add deps

```bash
cd /Users/liuxing/Desktop/cccode
pnpm add recharts date-fns
```

(Recharts is the de facto chart lib for React+shadcn. date-fns for date manipulation. No react-router; keep `useState` tab switching. No react-day-picker for v1 — use HTML `<input type="date">` styled with Tailwind for the range picker. If user later wants a calendar popover, swap in.)

### B2. Sidebar redesign

Create `src/components/sidebar/AppSidebar.tsx`:

- Fixed left column, 200px wide
- Top: brand block `<>` icon (use Lucide `Code2`) + "AI Code Stats" text
- Nav items:
  - 概况 (Lucide `Home` icon) — sets active tab `"overview"`
  - 统计 (Lucide `BarChart3` icon) — sets active tab `"stats"`
  - 会话 (Lucide `MessageSquare` icon) — sets active tab `"sessions"` (keep existing session list reachable)
- Bottom: 设置 (Lucide `Settings` icon) — sets `"settings"` (stub page with "敬请期待")
- Active item: blue background + blue text (use `bg-blue-50 text-blue-600` for light mode)
- Refactor `src/App.tsx` to: `useState<"overview"|"stats"|"sessions"|"settings">("overview")` with conditional render. **Default landing tab is "overview".**

### B3. Overview page

Create `src/components/overview/OverviewPage.tsx`:

**Header row:**
- Page title "概况" (h1, 24px, semibold)
- Date range picker (left): two `<input type="date">` joined by `~`, prefixed with Lucide `Calendar` icon, in a rounded border container. Default range: last 30 days.
- Project dropdown (right): reuses the existing `<select>` from `StatsPage.tsx` style. Default "全部项目". Source: `invoke<ProjectInfo[]>("list_projects")`.

**Two metric cards (2-col grid, gap 4):**
Each card:
- Icon top-left (Lucide `Code2` blue / `FileText` green)
- Label "生成代码行数" / "生成文件数量"
- Big number (text-4xl semibold tabular-nums)
- Bottom: "较上期 ↑12.5%" (green) or "↓5.2%" (red); use `null` from API → "—"
- Right side: `Sparkline` — a tiny recharts `<Area>` chart 100×40px using the daily series for that metric

**Trend chart:**
- Card with header "生成趋势" + a "按天/按周" toggle on right (button group, default 按天)
- Body: recharts `<ResponsiveContainer><ComposedChart>` with two `<YAxis>` (left = LOC, right = files) and two `<Area>` series (LOC blue gradient, files green gradient). X-axis ticks formatted "MM-DD".
- When "按周" toggled: aggregate `daily` into 7-day buckets client-side.

**Model distribution card:**
- Card header: "模型分布（按生成代码行数）"
- Body: 2-col grid
  - Left: recharts `<PieChart>` donut (innerRadius 60, outerRadius 90); center text shows `totalLoc` total
  - Right: table with cols 模型 / 生成代码行数 / 占比 / progress bar
- Colors (in order):
  - blue `#3b82f6`, green `#10b981`, purple `#a855f7`, orange `#f59e0b`, gray `#9ca3af` (for "其他")
- Use `byModel` from API directly

### B4. Data flow

On mount + on any of `(selectedProject, fromMs, toMs)` change:
```tsx
invoke<Overview>("compute_overview", { query: { project, fromMs, toMs } })
```

Loading state: skeleton or `RefreshCw` spinner in card.

### B5. Stats detail tab (统计)

Keep current `StatsPage.tsx` content but rename the page heading to "统计 · 明细". The 概况 tab is the new design; 统计 tab keeps the table-heavy view. No major changes here other than the sidebar wiring.

### B6. Settings tab

Create `src/components/settings/SettingsPage.tsx` with a card saying "敬请期待 · v2 将开放偏好设置". One line stub.

### B7. Type sync

Add to `src/types.ts`:

```ts
export interface DailyBucket { date: string; loc: number; files: number; }
export interface ModelBreakdown { model: string; loc: number; fileCount: number; percent: number; }
export interface Overview {
  totalLoc: number; totalFiles: number;
  locDeltaPercent: number | null; filesDeltaPercent: number | null;
  daily: DailyBucket[]; byModel: ModelBreakdown[];
  sessionCount: number; rangeFromMs: number; rangeToMs: number;
}
```

### B8. Verification

```bash
cd /Users/liuxing/Desktop/cccode
pnpm tsc --noEmit   # exit 0
```

Do NOT `pnpm tauri dev` (will hang). The leader will smoke-test manually.

---

## Global done criteria

- `cargo check` exit 0; `cargo test --lib` all pass (14 tests minimum)
- `pnpm tsc --noEmit` exit 0
- `recharts` and `date-fns` appear in `package.json` dependencies
- New files exist: `src/components/sidebar/AppSidebar.tsx`, `src/components/overview/OverviewPage.tsx`, `src/components/settings/SettingsPage.tsx`
- `src/App.tsx` routes to all 4 tabs (概况/统计/会话/设置), default tab is 概况
- `rusqlite` still NOT in `Cargo.lock`
