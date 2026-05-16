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

**既有基础设施**（不要重做）：
- `src/utils/providers.ts` 已有 `getResumeCommand(provider, id)` 返回 `claude --resume <id>` 字符串
- `useSessionEditing` hook 已经暴露 `supportsResumeCommand`, `handleCopyResumeCommand`
- 右键菜单 `SessionContextMenu.tsx` 和悬浮 dropdown `SessionNameEditor.tsx` 已经有"Copy Resume Command"项

**本次新增**：在已有"复制命令"项的旁边加一个"Launch in Claude Code"项（更直接：直接弹终端跑命令）。

**新工具函数**：`src/utils/sessionResume.ts`

```ts
export async function launchClaudeSessionInTerminal(
  projectPath: string,
  sessionId: string
): Promise<void>;
```

内部 `invoke('resume_claude_session', { projectPath, sessionId })`。错误透传，调用方负责 toast。

**Hook 改动**：`src/components/SessionItem/hooks/useSessionEditing.ts`
- 新增 `handleLaunchInTerminal: (e: React.MouseEvent) => void`
- 从 `useSessionEditing()` 返回值额外暴露：`handleLaunchInTerminal`
- 复用现有 `supportsResumeCommand` 判定（claude / forgecode 为 true，但只有 claude 真的能启）—— 见下条
- 新增 capability `supportsLaunchInTerminal`（仅 `claude` 为 true），加在 `PROVIDER_SESSION_CAPABILITIES` 表里

**UI 入口**：
1. `SessionContextMenu.tsx`（右键菜单）：在 `supportsResumeCommand` 块下方加一个 `supportsLaunchInTerminal` 块，菜单项文案 "Launch in Claude Code"（i18n `session.launchInClaudeCode`），icon 用 `Rocket`（lucide）
2. `SessionNameEditor.tsx`（hover dropdown）：同位置同样追加一项

主体不在 SessionItem 主区域增加显眼按钮（避免视觉拥挤）；要更显眼时哥哥可以走右键菜单或 ⋮ 按钮。

**i18n 新增键**（仅本次新增；复制命令的 `session.copyResumeCommand` 已存在不动）。

**i18n 新增键**（5 种语言全加）：

| key | en | ko | ja | zh-CN | zh-TW |
|---|---|---|---|---|---|
| `session.launchInClaudeCode` | Launch in Claude Code | Claude Code 에서 실행 | Claude Code で起動 | 在 Claude Code 中启动 | 在 Claude Code 中啟動 |
| `session.launchSuccess` | Opened new terminal | 새 터미널을 열었습니다 | 新しいターミナルを開きました | 已在新窗口打开 | 已在新視窗開啟 |
| `session.launchError` | Failed to start terminal | 터미널 실행 실패 | ターミナル起動失敗 | 启动终端失败 | 啟動終端失敗 |
| `session.launchUnsupportedPlatform` | Only Windows is supported | Windows에서만 지원됨 | Windows のみサポート | 仅支持 Windows | 僅支援 Windows |

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

具体改动：line ~118-126 的副标题区——当前在未选 session 时显示 `{t('common.appDescription')}` 作为第二行。改为：
- 没选 session 时 → 不渲染第二行（删 `<p>{t('common.appDescription')}</p>`）
- 选了 session 时 → 保持现状（显示 session summary）

不动：左上角主标题与项目路径分隔符；右上角搜索框、导航按钮区、设置 dropdown。

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

后端返回 `Err(String)`，前端按 prefix 解析为 toast：

| 错误前缀 | 触发 | 前端 toast |
|---|---|---|
| `INVALID_SESSION_ID` | session_id 不匹配 `^[A-Za-z0-9_-]+$` | "Invalid session id" |
| `PATH_NOT_FOUND` | project_path 不存在或不是目录 | "Project path no longer exists" |
| `SPAWN_FAILED:<原因>` | `Command::spawn` 失败 | `session.launchError` + 原因明文 |
| `UNSUPPORTED_PLATFORM` | 非 Windows | `session.launchUnsupportedPlatform` |

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

`src/test/useSessionEditing.test.tsx` 扩展：
- 新增对 `handleLaunchInTerminal` 的测试：仅 claude provider 时被允许；其他 provider 调用应静默不发起请求
- 错误回流时 hook 状态正常

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
