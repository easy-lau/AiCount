# Session Manager Extraction Spec

Extract the "Session Manager" feature from `cc-switch` into a standalone Tauri v2 desktop app.

- **Source repo (read-only):** `/Users/liuxing/Desktop/ccs/cc-switch`
- **Target repo (write here):** `/Users/liuxing/Desktop/cccode`
- **Providers kept:** `claude`, `codex`, `gemini` (drop `opencode`, `openclaw`, `hermes`)
- **Platforms:** macOS first (per original PRD), but keep code platform-agnostic where possible
- **No SQLite:** dropping opencode/hermes means `rusqlite` must NOT appear in `Cargo.toml`

## Coordination

There are exactly **2 subtasks**. Each worker MUST claim exactly one via the team runtime API before starting:

```bash
omc team api list-tasks --input '{"team_name":"<team>"}' --json
omc team api claim-task --input '{"team_name":"<team>","task_id":"<id>","worker_id":"<self>"}' --json
```

If both subtasks are already claimed, exit cleanly.

---

## Subtask A — Backend (Rust / Tauri)

Owner directory: `/Users/liuxing/Desktop/cccode/src-tauri/`

### A1. Scaffold the Tauri v2 project

If `/Users/liuxing/Desktop/cccode/package.json` does NOT exist, scaffold:

```bash
cd /Users/liuxing/Desktop/cccode
pnpm create tauri-app@latest . --template react-ts --manager pnpm --identifier com.cccode.sessionmanager --app-name "Session Manager"
```

Use non-interactive flags. If `pnpm create tauri-app` is interactive, fall back to manually creating:
- `package.json` with `tauri` scripts
- `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`
- `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`

Verify scaffold by running `pnpm install` (background OK).

### A2. Copy session_manager backend files

Copy from cc-switch (only these 3 providers):

```
SRC=/Users/liuxing/Desktop/ccs/cc-switch/src-tauri/src
DST=/Users/liuxing/Desktop/cccode/src-tauri/src

mkdir -p $DST/session_manager/providers $DST/session_manager/terminal $DST/commands

cp $SRC/session_manager/mod.rs                          $DST/session_manager/mod.rs
cp $SRC/session_manager/providers/mod.rs                $DST/session_manager/providers/mod.rs
cp $SRC/session_manager/providers/utils.rs              $DST/session_manager/providers/utils.rs
cp $SRC/session_manager/providers/claude.rs             $DST/session_manager/providers/claude.rs
cp $SRC/session_manager/providers/codex.rs              $DST/session_manager/providers/codex.rs
cp $SRC/session_manager/providers/gemini.rs             $DST/session_manager/providers/gemini.rs
cp $SRC/session_manager/terminal/mod.rs                 $DST/session_manager/terminal/mod.rs
cp $SRC/commands/session_manager.rs                     $DST/commands/session_manager.rs
```

### A3. Trim `session_manager/mod.rs`

In the copied `src-tauri/src/session_manager/mod.rs`:

- `use providers::{...}` → keep only `claude, codex, gemini`
- In `scan_sessions()`, remove the 3 thread spawns for `opencode/openclaw/hermes` (`h3, h4, h6`) and the corresponding `sessions.extend(...)` lines. Adjust the tuple destructuring.
- In `load_messages()`, delete both `if ... starts_with("sqlite:")` early-return branches entirely. Keep only the `claude/codex/gemini` arms in the `match`.
- In `delete_session()`, delete the same sqlite early-return branches. In `delete_session_with_root()` `match`, keep only `claude/codex/gemini` arms.
- In `provider_root()`, keep only `claude/codex/gemini` match arms. Replace their bodies to call the new `crate::paths` module (see A4):
  - `"codex" => crate::paths::get_codex_config_dir().join("sessions"),`
  - `"claude" => crate::paths::get_claude_config_dir().join("projects"),`
  - `"gemini" => crate::paths::get_gemini_dir().join("tmp"),`
- Remove the `delete_sessions` outcome `s2/s3` test case branches for unsupported providers if any; keep tests that don't depend on dropped providers.

### A4. Create `src-tauri/src/paths.rs`

```rust
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

pub fn get_gemini_dir() -> PathBuf {
    home().join(".gemini")
}
```

### A5. Fix imports in copied provider files

- `providers/claude.rs`: replace `use crate::config::get_claude_config_dir;` → `use crate::paths::get_claude_config_dir;`
- `providers/codex.rs`: replace `use crate::codex_config::get_codex_config_dir;` → `use crate::paths::get_codex_config_dir;`
- `providers/gemini.rs`: if it references `crate::gemini_config::*`, replace with `crate::paths::*` (check imports)
- `providers/mod.rs`: drop `pub mod opencode; pub mod openclaw; pub mod hermes;` lines if present. Keep `claude, codex, gemini, utils`.

### A6. Fix `commands/session_manager.rs`

The original calls `crate::settings::get_preferred_terminal()`. Replace it with a default:

```rust
let preferred: Option<String> = std::env::var("CCCODE_TERMINAL").ok();
let target = match preferred.as_deref() {
    Some("iterm2") => "iterm".to_string(),
    Some(t) => t.to_string(),
    None => "terminal".to_string(),
};
```

Also add `#![allow(non_snake_case)]` at the top is already present — keep it.

### A7. Create `commands/mod.rs`

```rust
pub mod session_manager;

pub use session_manager::{
    delete_session, delete_sessions, get_session_messages, launch_session_terminal, list_sessions,
};
```

### A8. Wire into `src-tauri/src/lib.rs`

Replace the scaffolded `lib.rs` (the default `greet` example) with:

```rust
mod paths;
mod session_manager;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_sessions,
            commands::get_session_messages,
            commands::delete_session,
            commands::delete_sessions,
            commands::launch_session_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### A9. Set `src-tauri/Cargo.toml` dependencies

Replace whatever scaffolding wrote with this minimal set:

```toml
[package]
name = "cccode"
version = "0.1.0"
description = "Session Manager for Claude / Codex / Gemini CLI"
authors = ["liuxing"]
license = "MIT"
edition = "2021"
rust-version = "1.85.0"

[lib]
name = "cccode_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.4.0", features = [] }

[dependencies]
tauri = { version = "2.8.2", features = ["tray-icon", "protocol-asset", "image-png"] }
tauri-plugin-opener = "2"
tauri-plugin-dialog = "2"
serde = { version = "1.0", features = ["derive"] }
serde_json = { version = "1.0", features = ["preserve_order"] }
chrono = { version = "0.4", features = ["serde"] }
dirs = "5.0"
regex = "1.10"
log = "0.4"
thiserror = "2.0"
anyhow = "1.0"
once_cell = "1.21"

[dev-dependencies]
tempfile = "3"
```

**Do NOT include rusqlite.** If you encounter a compile error pointing to rusqlite usage, that means stale opencode/hermes references survived in the copied code — re-check A3/A5.

### A10. Compile-check the backend

```bash
cd /Users/liuxing/Desktop/cccode/src-tauri
cargo check 2>&1 | tail -60
```

Iterate until `cargo check` succeeds. Common fixes:
- Unused imports → remove
- Missing `chrono` feature `serde` → already in toml
- `tauri.conf.json` window/identifier mismatch → keep scaffold default for now

**Mark task done via `omc team api complete-task` only when `cargo check` exits 0.**

---

## Subtask B — Frontend (React / TypeScript)

Owner directory: `/Users/liuxing/Desktop/cccode/src/`

### B1. Wait for Subtask A to scaffold the project

Poll `/Users/liuxing/Desktop/cccode/package.json` existence every 10s for up to 5 minutes. If still missing, run the scaffold yourself (see A1).

### B2. Copy frontend session components

```
SRC=/Users/liuxing/Desktop/ccs/cc-switch/src
DST=/Users/liuxing/Desktop/cccode/src

mkdir -p $DST/components/sessions $DST/components/ui $DST/lib

cp $SRC/components/sessions/SessionManagerPage.tsx   $DST/components/sessions/
cp $SRC/components/sessions/SessionItem.tsx          $DST/components/sessions/
cp $SRC/components/sessions/SessionMessageItem.tsx   $DST/components/sessions/
cp $SRC/components/sessions/SessionToc.tsx           $DST/components/sessions/
cp $SRC/components/sessions/utils.ts                 $DST/components/sessions/
```

### B3. Identify and copy shadcn/ui dependencies

Inspect imports in the copied files (`grep -hE "^import" src/components/sessions/*.tsx`) and copy referenced `@/components/ui/*` files from `cc-switch/src/components/ui/`. Copy at minimum:
- `button.tsx` `input.tsx` `dialog.tsx` `dropdown-menu.tsx` `scroll-area.tsx` `tooltip.tsx` `badge.tsx`
- Whatever else `SessionManagerPage` actually imports.

Also copy `src/lib/utils.ts` from cc-switch (the `cn` helper).

### B4. Remove cross-feature coupling

In `SessionManagerPage.tsx`:
- Change signature from `export function SessionManagerPage({ appId }: { appId: string })` to `export function SessionManagerPage()`
- Replace `appId as ProviderFilter` (around line 92) with `"all" as ProviderFilter`
- Strip any imports from features outside `sessions/`, `ui/`, `lib/` (e.g. provider switching, settings panels). If `useTranslation` is used, replace `t("session.xxx")` calls with inline Chinese strings or English defaults — DON'T pull in react-i18next unless trivial.

In `SessionItem.tsx`, `SessionMessageItem.tsx`, `SessionToc.tsx`: same — strip cross-feature imports.

### B5. Update `package.json` deps

Run from `/Users/liuxing/Desktop/cccode/`:

```bash
pnpm add @tauri-apps/api @tauri-apps/plugin-opener @tauri-apps/plugin-dialog \
  class-variance-authority clsx tailwind-merge lucide-react \
  @radix-ui/react-dialog @radix-ui/react-dropdown-menu \
  @radix-ui/react-scroll-area @radix-ui/react-tooltip

pnpm add -D tailwindcss postcss autoprefixer @types/node
```

Configure Tailwind: copy `tailwind.config.cjs`, `postcss.config.cjs`, `src/index.css` from cc-switch (or generate fresh via `pnpm exec tailwindcss init -p`).

### B6. Replace `src/App.tsx`

Make it render just the `SessionManagerPage`:

```tsx
import { SessionManagerPage } from "@/components/sessions/SessionManagerPage";

export default function App() {
  return (
    <div className="h-screen w-screen overflow-hidden">
      <SessionManagerPage />
    </div>
  );
}
```

### B7. Configure path alias `@/*`

In `tsconfig.json` (compilerOptions):
```json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

In `vite.config.ts`:
```ts
import path from "node:path";
// ...
resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
```

### B8. Smoke-build the frontend

```bash
cd /Users/liuxing/Desktop/cccode
pnpm install
pnpm tsc --noEmit 2>&1 | tail -60
```

Iterate until tsc passes. **Mark task done only when tsc exits 0.**

---

## Done criteria (both subtasks complete)

- `cd /Users/liuxing/Desktop/cccode/src-tauri && cargo check` succeeds (0 errors, warnings OK)
- `cd /Users/liuxing/Desktop/cccode && pnpm tsc --noEmit` succeeds
- `rusqlite` does NOT appear in `Cargo.lock`
- File tree exists: `src-tauri/src/{paths.rs, session_manager/{mod.rs, providers/{claude,codex,gemini,utils,mod}.rs, terminal/mod.rs}, commands/{mod.rs, session_manager.rs}, lib.rs}` and `src/components/sessions/{SessionManagerPage,SessionItem,SessionMessageItem,SessionToc}.tsx`

Do NOT run `pnpm tauri dev` — that needs a display and will hang. Stop at type/compile check.
