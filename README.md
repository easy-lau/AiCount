# AICount

> 统计 Claude Code / Codex CLI 在你本机生成了多少代码的桌面工具

AICount 通过解析 [Claude Code](https://docs.claude.com/en/docs/claude-code) 和 [Codex CLI](https://github.com/openai/codex) 的本地会话日志，计算 AI 生成代码的行数、文件数、按模型与日期的分布，并展示 AI 生成在整个项目代码中的占比。

零网络请求、全本地解析，不上传任何会话内容。

---

## 功能

- **概况大盘**：总代码数、AI 生成代码行数、AI 生成代码占比、生成文件数量
- **按时间维度统计**：日期范围预设（当天 / 1d / 7d / 14d / 30d）+ 自定义日历筛选
- **按项目维度统计**：自动按 `cwd` 聚合，下拉切换单个项目或查看全部
- **生成趋势**：双轴折线图（代码行数 / 文件数量），支持按天 / 按周聚合
- **模型分布**：环形饼图 + 表格，按模型展示 LOC、文件数、占比
- **支持的 Provider**：Claude Code、Codex CLI（Gemini 暂无 tool 调用日志，不支持）

## 截图

> _待补充_

## 下载安装

前往 [Releases](https://github.com/easy-lau/AiCount/releases) 下载对应平台的安装包。

| 平台 | 文件 |
|---|---|
| macOS (Apple Silicon) | `AICount_x.y.z_aarch64.dmg` |
| macOS (Intel) | `AICount_x.y.z_x64.dmg` |
| Windows x64 | `AICount_x.y.z_x64-setup.exe` 或 `_x64_en-US.msi` |

### macOS 首次打开

应用未签名，会被 Gatekeeper 拦截。**右键 → 打开**，或：

```bash
xattr -dr com.apple.quarantine /Applications/AICount.app
```

### Windows 首次打开

SmartScreen 可能提示 "Unknown publisher"，点 **More info → Run anyway**。

## 数据来源

AICount **只读** 以下路径，不会修改、上传或删除任何内容：

- Claude Code：`~/.claude/projects/**/*.jsonl`
- Codex CLI：`~/.codex/sessions/**/*.jsonl`

代码量根据这两类会话里的工具调用计算：

- **Claude**：`Write` / `Edit` / `MultiEdit` / `NotebookEdit` 四种 tool_use 事件的内容行数
- **Codex**：`apply_patch` heredoc 内 `*** Begin Patch` / `*** End Patch` 之间的 `+` / `-` 行

工程整体代码行数通过递归扫描项目目录得出（跳过 `node_modules / target / .git / dist / build` 等噪音目录，限制源文件扩展名白名单和单文件 5 MB 上限），结果会以文件 mtime 为 key 做内存缓存。

## 本地开发

### 前置

- Node.js 20+
- pnpm 9+
- Rust stable（推荐用 [rustup](https://rustup.rs/)）

### 启动

```bash
git clone https://github.com/easy-lau/AiCount.git
cd AiCount
pnpm install
pnpm tauri dev
```

### 测试

```bash
# 前端类型检查
pnpm tsc --noEmit

# 后端 + 单元测试
cd src-tauri
cargo check
cargo test --lib
```

### 打包

```bash
pnpm tauri build
```

产物在 `src-tauri/target/release/bundle/`。

## 技术栈

- **前端**：React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui + Recharts
- **后端**：Rust + Tauri v2
- **数据**：本地 JSONL 流式解析，`once_cell` 内存缓存

## License

MIT

## 联系作者

有 bug 或建议请联系 [liuxing@authine.com](mailto:liuxing@authine.com)。
