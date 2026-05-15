# Code Stats — Implementation Coordination

**Plan (read this first, in full):** `/Users/liuxing/Desktop/cccode/.omc/plans/2026-05-14-code-stats.md`

**Target:** `/Users/liuxing/Desktop/cccode` (existing Tauri app, current dir)

## Coordination

There are exactly **2 subtasks**. Each worker MUST claim exactly one via:

```bash
omc team api list-tasks --input '{"team_name":"<team>"}' --json
omc team api claim-task --input '{"team_name":"<team>","task_id":"<id>","worker_id":"<self>"}' --json
```

If both are claimed already, exit cleanly.

---

## Subtask A — Backend (Rust)

Owner: `src-tauri/src/code_stats/**` + `src-tauri/src/commands/code_stats.rs` + wire-up in `lib.rs` and `commands/mod.rs`.

Follow plan section **3.1** verbatim:

1. Create `src-tauri/src/code_stats/{mod.rs, claude.rs, codex.rs}` with the structures and parsers described
2. Create `src-tauri/src/commands/code_stats.rs` with the `compute_code_stats` Tauri command
3. Wire `mod code_stats;` into `lib.rs` and append `commands::compute_code_stats` to the `invoke_handler!` list
4. Add `pub mod code_stats; pub use code_stats::compute_code_stats;` to `commands/mod.rs`
5. Add unit tests covering AC2 + AC3 (Claude Write/Edit/MultiEdit fixture, Codex apply_patch heredoc fixture)
6. **Whitelist filter:** Only `Write`, `Edit`, `MultiEdit`, `NotebookEdit` count. Skip every other tool name (Read, Bash, Glob, Grep, etc.) — otherwise the metric is meaningless.
7. **Cache:** in-process `once_cell::sync::Lazy<Mutex<HashMap<PathBuf, (SystemTime, SessionStat)>>>` keyed by `(path, mtime)`. No disk persistence in v1.
8. **Time bucketing:** treat `last_active_at` (or each tool_use `timestamp`) in UTC; "this week" = last 7 days, "this month" = last 30 days from `chrono::Utc::now()`.

**Codex apply_patch parsing detail (don't skip):**
- Event: `function_call` where `payload.name == "exec_command"`
- Parse `payload.arguments` as JSON → get the `cmd` string
- Inside `cmd`, locate `*** Begin Patch` and `*** End Patch` substrings (literal, not regex)
- Between them, iterate lines: 
  - skip lines starting with `*** ` (file headers like `*** Update File: foo`)
  - count lines starting with `+` (not `+++ `) → added
  - count lines starting with `-` (not `--- `) → removed
- The heredoc quoting (`<<'EOF'`, `<<EOF`, `<<-EOF`) is irrelevant — the markers are inside the captured cmd string

**Done when:**
```bash
. "$HOME/.cargo/env" && cd /Users/liuxing/Desktop/cccode/src-tauri && cargo check  # exit 0
. "$HOME/.cargo/env" && cd /Users/liuxing/Desktop/cccode/src-tauri && cargo test code_stats  # all green
```

Mark `transition-task-status` → `completed` only after both pass.

---

## Subtask B — Frontend (React/TS)

Owner: `src/components/stats/**`, `src/types.ts` extensions, `src/App.tsx` sidebar tab.

Follow plan section **3.2** verbatim:

1. Create `src/components/stats/{StatsPage.tsx, StatBar.tsx, utils.ts}`
2. Define `CodeStats` / `LocDelta` / `FileLoc` types in `src/types.ts` (mirror the Rust structs — use `camelCase` field names since Rust derives `#[serde(rename_all = "camelCase")]`)
3. Refactor `src/App.tsx` to a 2-tab layout with a left sidebar:
   - Two buttons: "Sessions" and "Stats"
   - `useState<"sessions" | "stats">("sessions")` for routing
   - Conditional render based on state
   - **Do NOT** introduce `react-router`
4. `StatsPage` calls `invoke<CodeStats>("compute_code_stats")` on mount, renders:
   - Big header with total LOC (added/removed/net)
   - "This week" / "This month" counters
   - Per-provider bars (Claude vs Codex)
   - Top 5 projects with their LOC delta
   - Top 10 files
5. Use existing shadcn/ui primitives already in the project; only add Lucide icons if needed for the sidebar.
6. Subtitle on Stats page: "Showing Claude + Codex. Gemini sessions don't log code edits."

**Coordination note:** Worker A will modify `lib.rs` / `commands/mod.rs`. Worker B will modify `App.tsx` / add `types.ts` entries. **No file overlap** — work freely in parallel.

**Done when:**
```bash
cd /Users/liuxing/Desktop/cccode && pnpm tsc --noEmit  # exit 0
```

Mark `transition-task-status` → `completed` only after tsc passes.

---

## Global done criteria

- All 8 acceptance criteria in the plan are satisfied
- `cargo check` AND `cargo test code_stats` AND `pnpm tsc --noEmit` all exit 0
- `rusqlite` still NOT in `Cargo.lock`
- Do NOT run `pnpm tauri dev` (it will hang the worker; leader will smoke-test manually)
