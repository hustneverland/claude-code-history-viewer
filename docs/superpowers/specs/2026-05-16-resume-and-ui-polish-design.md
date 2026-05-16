# Resume Button & UI Polish Design Spec

**Date**: 2026-05-16
**Status**: Draft
**Fork target**: 个人 fork（不向上游 PR）
**Branch base**: `develop`

## Problem

哥哥日常用 Claude Code 在 Windows 上工作，遇到三个痛点：

1. **左侧项目名展示诡异**：当前显示 encode 后的 `D--github-claude-code-history-viewer`，看不出真实路径
2. **没有"继续会话"入口**：在 viewer 里找到目标会话后，还得手动切到对应目录、记/复制 session ID、再敲 `claude --resume`
3. （会话标题不好用、有时找不到会话——本次范围外，留 v2）

## Goal

在个人 fork 上落地：

- **G1**：左侧项目名展示真实路径的最后一级 + tooltip 显示完整路径
- **G2**：会话项加一个一键按钮 → 弹独立 PowerShell 窗口 → `cd` 项目目录并 `claude --resume <session-id>`
- **G3**：左侧栏 / 会话列表项 / 顶部 header 做"中等"视觉收敛，去掉小体验瑕疵

## Non-goals

- LLM 自动起会话标题（v2）
- "会话找不到"问题排查（v2）
- 其他 provider（Codex、Cursor、Gemini 等）的 resume 适配
- macOS / Linux 平台支持（仅 Windows）
- 配色 / 主题改造
- SessionBoard、分析仪表盘、设置管理器等模块的视觉变动

## Solution

分三块：后端新命令、前端按钮 + 显示逻辑、UI 局部收敛。不引入新设置项，PowerShell 写死。

## Architecture

### A. Backend: Tauri Command `resume_claude_session`

**新文件**：`src-tauri/src/commands/resume.rs`

```rust
#[tauri::command]
pub fn resume_claude_session(
    project_path: String,
    session_id: String,
) -> Result<(), String>;
```

**入参验证**：
- `project_path` 必须是已存在的目录，且为绝对路径
- `session_id` 必须匹配 `^[A-Za-z0-9_-]+$`（防命令注入）

**Windows 实现**：

```rust
#[cfg(target_os = "windows")]
fn launch_powershell(project_path: &str, session_id: &str) -> Result<(), String> {
    // PowerShell 单引号转义：' → ''
    let escaped_path = project_path.replace('\'', "''");
    let ps_command = format!(
        "Set-Location -LiteralPath '{}'; claude --resume {}",
        escaped_path, session_id
    );

    Command::new("cmd")
        .args(&["/c", "start", "powershell", "-NoExit", "-Command", &ps_command])
        .spawn()
        .map_err(|e| format!("Failed to launch terminal: {}", e))?;
    Ok(())
}
```

**非 Windows**：
```rust
#[cfg(not(target_os = "windows"))]
pub fn resume_claude_session(_: String, _: String) -> Result<(), String> {
    Err("RESUME_UNSUPPORTED_PLATFORM".into())
}
```

错误 code 用稳定字符串，前端按 code 翻译展示。

**注册**：`src-tauri/src/lib.rs` 的 `invoke_handler` 中追加 `resume_claude_session`。

**测试**（`src-tauri/src/commands/resume.rs` 内）：
- `session_id` 注入校验（`abc; rm -rf /` 应被拒绝）
- 路径不存在应返回错误
- 单引号转义正确

### B. Frontend: Resume 按钮

**新工具函数**：`src/utils/sessionResume.ts`

```ts
export async function resumeClaudeSession(
  projectPath: string,
  sessionId: string
): Promise<void>;
```

内部 `invoke('resume_claude_session', { projectPath, sessionId })`，错误统一抛 `ResumeError`，调用方负责 toast。

**改动文件**：`src/components/SessionItem/components/SessionHeader.tsx`

- 在已有操作区（重命名 / 删除附近）加 `▶ 继续` 按钮
- 仅当 `session.provider === 'claude'` 时渲染
- 点击：调 `resumeClaudeSession`，成功 toast `提示：已在新窗口打开`，失败 toast 错误信息
- 按钮 `aria-label` 必填，i18n 走 `t('session.resumeInClaudeCode')`

**i18n 新增键**（5 种语言全加）：

| key | en | ko | ja | zh-CN | zh-TW |
|---|---|---|---|---|---|
| `session.resumeInClaudeCode` | Resume in Claude Code | Claude Code에서 이어하기 | Claude Code で続行 | 在 Claude Code 中继续 | 在 Claude Code 中繼續 |
| `session.resumeSuccess` | Opened new terminal | 새 터미널을 열었습니다 | 新しいターミナルを開きました | 已在新窗口打开 | 已在新視窗開啟 |
| `session.resumeError` | Failed to start terminal | 터미널 실행 실패 | ターミナル起動失敗 | 启动终端失败 | 啟動終端失敗 |
| `session.resumeUnsupportedPlatform` | Only Windows is supported | Windows에서만 지원됨 | Windows のみサポート | 仅支持 Windows | 僅支援 Windows |

文件归属：放在 `locales/<lang>/session.json`。

放完后跑 `pnpm run generate:i18n-types` + `pnpm run i18n:validate`。

### C. UI 收敛改动

#### C1. ProjectItem 显示真实路径

**改动文件**：`src/components/ProjectTree/components/ProjectItem.tsx`

当前 `displayName` 在 non-grouped 情况下用的是 `project.name`（encode 形式）。改为：

```ts
const displayName = isMain
  ? t("project.main", "main")
  : isWorktree
    ? getWorktreeLabel(project.actual_path)
    : getProjectDisplayName(project.actual_path, project.name);  // ← 改这里
```

**新工具函数**：`src/utils/pathDisplay.ts`

```ts
/**
 * 从绝对路径取最后一级目录名作为展示名。
 * actual_path 缺失或为空时回退到 fallbackName（兼容旧数据）。
 */
export function getProjectDisplayName(
  actualPath: string | null | undefined,
  fallbackName: string
): string;
```

实现要点：
- 支持 Windows (`\`) 和 POSIX (`/`) 分隔符（参照 CLAUDE.md 的 cross-platform checklist：`split(/[\\/]/)`）
- 去末尾分隔符后取最后一段，空串回退到 fallback

**单测**：`src/utils/__tests__/pathDisplay.test.ts`
- Windows 路径 → 末段
- POSIX 路径 → 末段
- 末尾带分隔符
- 空 / null → fallback

#### C2. ProjectItem hover 抖动

`ProjectItem.tsx` 当前 hover 时加 `pl-5`（左 padding 跳变），整行会"抖一下"。改为去掉 `hover:pl-5` 和对应展开态 `pl-5`，统一用稳定的 border-left 高亮即可（borderLeft transparent → accent）。

#### C3. 顶部 Header 简化

**改动文件**：`src/layouts/Header/Header.tsx`

- 左上角双行（标题"Claude Code History Viewer" + 副标题"探索和分析您的 Claude Code 对话历史"）→ 单行只保留标题
- 副标题信息密度低，去掉腾出垂直空间

不动：右上角搜索框、归档按钮、过滤器、设置图标。

## Data Flow

```
SessionItem (Claude 会话)
   ↓ click ▶ 继续
resumeClaudeSession()
   ↓ Tauri invoke
resume_claude_session (Rust)
   ↓ validate inputs
   ↓ spawn: cmd /c start powershell -NoExit -Command "Set-Location ...; claude --resume <id>"
独立 PowerShell 窗口
   ↓ user 接续聊天
```

## Error Handling

| 错误码 | 触发 | 前端表现 |
|---|---|---|
| `RESUME_INVALID_SESSION_ID` | session_id 不匹配白名单 | toast: "Invalid session id" |
| `RESUME_PATH_NOT_FOUND` | project_path 不存在 | toast: "Project path no longer exists" |
| `RESUME_SPAWN_FAILED` | `Command::spawn` 失败 | toast: "启动终端失败" + 详细原因 |
| `RESUME_UNSUPPORTED_PLATFORM` | 非 Windows | toast: "仅支持 Windows" |

## Security

- `session_id` 严格白名单：`^[A-Za-z0-9_-]+$`，禁止任何特殊字符
- `project_path` 校验存在性 + 是目录
- PowerShell 单引号转义防止字符串注入
- 不通过 shell 字符串拼接调用，而是通过 `Command::args`（命令本身用 `cmd start`，参数已经被 `args` 转义）

## Testing

### Rust

`src-tauri/src/commands/resume.rs` 单测：

1. `session_id` 校验：拒绝 `abc;rm`, `../../etc/passwd`, 空字符串, 含空格
2. `session_id` 接受合法值：`8a1f2b3c-...`、纯字母数字
3. 路径不存在返回 `RESUME_PATH_NOT_FOUND`
4. 单引号转义函数 escape 后双引号成对

跑：`cargo test -- --test-threads=1`（项目惯例）

### Frontend

`src/utils/__tests__/pathDisplay.test.ts` 单测同上 C1。

`src/components/SessionItem/components/__tests__/SessionHeader.resume.test.tsx`：
- 仅 Claude provider 显示按钮
- 其他 provider 不显示
- 点击调用 `resumeClaudeSession`
- 错误时显示对应 toast

跑：`pnpm vitest run`

### 手测清单（哥哥本地）

- [ ] 点击 ▶ 继续，弹出 PowerShell 新窗口
- [ ] 窗口 cwd 是项目目录
- [ ] `claude --resume <id>` 自动执行并进入会话
- [ ] 窗口不会自动关闭（`-NoExit`）
- [ ] 项目名变成 `claude-code-history-viewer` 而不是 `D--github-...`
- [ ] hover 项目名不再左右抖动
- [ ] Header 单行不挤

## Branch & PR

- Fork 到哥哥个人 GitHub
- 分支：`feature/resume-and-ui-polish`，base `develop`
- PR base: 哥哥 fork 的 `develop`
- 不向上游 anthropics 提 PR

## Out of Scope (留 v2)

- LLM 自动起会话标题
- 会话搜索 / 找不到问题排查
- Codex / Cursor / Gemini 等其他 provider 的 resume
- 终端选择设置项（PowerShell 写死）
- macOS / Linux 平台支持

## Open Questions

无（三个不确定点已在 brainstorm 阶段全部解决）。
