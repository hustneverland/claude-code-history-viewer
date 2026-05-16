# Resume Button & UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在个人 fork 上加一个"在新 PowerShell 窗口中 resume Claude Code 会话"的菜单项，并修两个 UI 瑕疵（项目名 encode、Header 副标题、hover 抖动）。

**Architecture:** 后端新增 Tauri 命令 `resume_claude_session`，在 Windows 上用 `cmd /c start powershell -NoExit -Command "Set-Location ...; claude --resume <id>"` 启独立窗口；前端在既有的"复制 resume 命令"基础设施旁加一个"Launch in Claude Code"菜单项，复用 `useSessionEditing` hook。

**Tech Stack:** Rust (Tauri 2), TypeScript, React, react-i18next, vitest, cargo test, sonner (toast), shadcn dropdown / context menu

---

## File Structure

**Create:**
- `src-tauri/src/commands/resume.rs` — Tauri command + Windows launcher + 单元测试
- `src/utils/sessionResume.ts` — `launchClaudeSessionInTerminal(projectPath, sessionId)` 包装层
- `src/utils/pathDisplay.ts` — `getProjectDisplayName(actualPath, fallback)`
- `src/utils/__tests__/pathDisplay.test.ts` — 单测

**Modify:**
- `src-tauri/src/commands/mod.rs` — 导出 resume 模块
- `src-tauri/src/lib.rs` — 注册新命令到 `invoke_handler!`
- `src/utils/providers.ts` — 加 `supportsLaunchInTerminal` capability
- `src/components/SessionItem/hooks/useSessionEditing.ts` — 加 `handleLaunchInTerminal` 处理函数和返回值
- `src/components/SessionItem/types.ts` — 加 `supportsLaunchInTerminal` / `onLaunchInTerminal` prop
- `src/components/SessionItem/components/SessionContextMenu.tsx` — 加新菜单项
- `src/components/SessionItem/components/SessionNameEditor.tsx` — 加新 dropdown 项
- `src/components/SessionItem/SessionItem.tsx` — 把新 prop 透传给子组件
- `src/i18n/locales/{en,ko,ja,zh-CN,zh-TW}/session.json` — 4 个新 key
- `src/components/ProjectTree/components/ProjectItem.tsx` — 切换 displayName 来源 + 移除 hover 抖动
- `src/layouts/Header/Header.tsx` — 删 appDescription 副标题
- `src/test/useSessionEditing.test.tsx` — 扩展用例

---

## Task 1: 后端 `resume_claude_session` 命令

**Files:**
- Create: `src-tauri/src/commands/resume.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1.1: 先写失败的 Rust 单测**

新建文件 `src-tauri/src/commands/resume.rs`，先只写测试框架和签名让它编译失败：

```rust
use std::path::Path;

pub fn validate_session_id(id: &str) -> Result<(), String> {
    todo!()
}

pub fn escape_powershell_single_quoted(s: &str) -> String {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_session_id_accepts_alphanum_and_dash() {
        assert!(validate_session_id("8a1f2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c").is_ok());
        assert!(validate_session_id("abc123").is_ok());
        assert!(validate_session_id("a_b-c").is_ok());
    }

    #[test]
    fn validate_session_id_rejects_injection_attempts() {
        for bad in &["", " ", "abc; rm -rf /", "../../etc", "id with space", "id&calc"] {
            assert!(
                validate_session_id(bad).is_err(),
                "should reject {:?}",
                bad
            );
        }
    }

    #[test]
    fn escape_powershell_single_quoted_doubles_single_quotes() {
        assert_eq!(escape_powershell_single_quoted("abc"), "abc");
        assert_eq!(escape_powershell_single_quoted("a'b"), "a''b");
        assert_eq!(escape_powershell_single_quoted("'"), "''");
    }
}
```

- [ ] **Step 1.2: 运行测试看失败**

Run: `cd src-tauri && cargo test --lib commands::resume:: -- --test-threads=1`

Expected: 编译失败 / panic (`todo!`)

- [ ] **Step 1.3: 实现 validate_session_id + escape_powershell_single_quoted**

替换 `src-tauri/src/commands/resume.rs` 的两个 `todo!()` 为实现：

```rust
pub fn validate_session_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("INVALID_SESSION_ID".into());
    }
    let all_ok = id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !all_ok {
        return Err("INVALID_SESSION_ID".into());
    }
    Ok(())
}

pub fn escape_powershell_single_quoted(s: &str) -> String {
    s.replace('\'', "''")
}
```

- [ ] **Step 1.4: 跑测试 PASS**

Run: `cd src-tauri && cargo test --lib commands::resume:: -- --test-threads=1`

Expected: `test result: ok. 3 passed`

- [ ] **Step 1.5: 加 Tauri 命令 + 平台分支**

在 `src-tauri/src/commands/resume.rs` 末尾（`#[cfg(test)]` 之前）追加：

```rust
#[tauri::command]
pub fn resume_claude_session(
    project_path: String,
    session_id: String,
) -> Result<(), String> {
    validate_session_id(&session_id)?;

    let path = Path::new(&project_path);
    if !path.is_dir() {
        return Err("PATH_NOT_FOUND".into());
    }

    launch_claude_in_powershell(&project_path, &session_id)
}

#[cfg(target_os = "windows")]
fn launch_claude_in_powershell(project_path: &str, session_id: &str) -> Result<(), String> {
    use std::process::Command;
    let escaped = escape_powershell_single_quoted(project_path);
    let ps_command = format!(
        "Set-Location -LiteralPath '{}'; claude --resume {}",
        escaped, session_id
    );
    Command::new("cmd")
        .args(["/c", "start", "powershell", "-NoExit", "-Command", &ps_command])
        .spawn()
        .map_err(|e| format!("SPAWN_FAILED:{}", e))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_claude_in_powershell(_project_path: &str, _session_id: &str) -> Result<(), String> {
    Err("UNSUPPORTED_PLATFORM".into())
}
```

- [ ] **Step 1.6: 加路径校验测试**

在 `tests` 模块内继续追加测试：

```rust
#[test]
fn resume_rejects_nonexistent_path() {
    let r = resume_claude_session(
        "Z:\\definitely-does-not-exist-12345".into(),
        "abc123".into(),
    );
    assert_eq!(r.unwrap_err(), "PATH_NOT_FOUND");
}

#[test]
fn resume_rejects_invalid_session_id() {
    let cwd = std::env::current_dir().unwrap();
    let r = resume_claude_session(cwd.to_string_lossy().into_owned(), "bad; id".into());
    assert_eq!(r.unwrap_err(), "INVALID_SESSION_ID");
}

#[cfg(not(target_os = "windows"))]
#[test]
fn resume_rejects_non_windows() {
    let cwd = std::env::current_dir().unwrap();
    let r = resume_claude_session(cwd.to_string_lossy().into_owned(), "abc123".into());
    assert_eq!(r.unwrap_err(), "UNSUPPORTED_PLATFORM");
}
```

Run: `cd src-tauri && cargo test --lib commands::resume:: -- --test-threads=1`

Expected: 全 PASS

- [ ] **Step 1.7: 把 module 接入 commands/mod.rs**

打开 `src-tauri/src/commands/mod.rs`，在模块声明区按字母序加：

```rust
pub mod resume;
```

- [ ] **Step 1.8: 把命令注册到 invoke_handler**

打开 `src-tauri/src/lib.rs`，在 `use crate::commands::{...}` 块的合适位置加：

```rust
use crate::commands::resume::resume_claude_session;
```

并在 `tauri::generate_handler![...]`（line ~153 起）的命令列表中追加 `resume_claude_session,`。

- [ ] **Step 1.9: 跑完整后端检查**

Run（依次）：
```bash
cd src-tauri && cargo test -- --test-threads=1
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --all -- --check
cd ..
```

Expected: 全部通过。

- [ ] **Step 1.10: 提交**

```bash
git add src-tauri/src/commands/resume.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(backend): add resume_claude_session command (Windows PowerShell)"
```

---

## Task 2: 前端 `supportsLaunchInTerminal` capability

**Files:**
- Modify: `src/utils/providers.ts`

- [ ] **Step 2.1: 加字段到 ProviderSessionCapability**

在 `src/utils/providers.ts` 中：

```ts
export interface ProviderSessionCapability {
  supportsConversationBreakdown: boolean;
  supportsNativeRename: boolean;
  supportsResumeCommand: boolean;
  supportsLaunchInTerminal: boolean;  // ← 新增
  supportsSessionDeletion: boolean;
  supportsArchiveCreation: boolean;
}
```

- [ ] **Step 2.2: 给 9 个 provider 填值**

在同文件的 `PROVIDER_SESSION_CAPABILITIES` 表里，给每个 provider 加 `supportsLaunchInTerminal`：
- `claude`: `true`
- 其余 8 个 (aider, antigravity, cline, codex, cursor, forgecode, gemini, opencode): 全部 `false`

注：forgecode 虽然 `supportsResumeCommand` 是 true，但这次只做 Claude 的 launch，所以 `supportsLaunchInTerminal` 给 false。

- [ ] **Step 2.3: 加导出辅助函数**

在文件末尾（`supportsArchiveCreation` 函数附近）加：

```ts
export function supportsLaunchInTerminal(provider?: ProviderId | string): boolean {
  if (provider == null || !PROVIDER_IDS.includes(provider as ProviderId)) {
    return false;
  }
  return PROVIDER_SESSION_CAPABILITIES[provider as ProviderId].supportsLaunchInTerminal;
}
```

- [ ] **Step 2.4: TypeScript 类型检查**

Run: `pnpm tsc --build .`

Expected: 无 type error。如果有调用 `PROVIDER_SESSION_CAPABILITIES` 的地方因新字段报错，那是因为字面量缺字段；按 Step 2.2 修复。

- [ ] **Step 2.5: 提交**

```bash
git add src/utils/providers.ts
git commit -m "feat(providers): add supportsLaunchInTerminal capability"
```

---

## Task 3: `sessionResume.ts` Tauri 调用包装

**Files:**
- Create: `src/utils/sessionResume.ts`

- [ ] **Step 3.1: 实现包装**

```ts
// src/utils/sessionResume.ts
import { api } from "@/services/api";

/**
 * 在新 PowerShell 窗口中 cd 到项目目录并执行 `claude --resume <session-id>`。
 * Windows-only. 失败时 throw，错误消息为后端约定的 prefix 字符串
 * (例如 "INVALID_SESSION_ID" / "PATH_NOT_FOUND" / "SPAWN_FAILED:<reason>" /
 * "UNSUPPORTED_PLATFORM")。
 */
export async function launchClaudeSessionInTerminal(
  projectPath: string,
  sessionId: string
): Promise<void> {
  await api("resume_claude_session", { projectPath, sessionId });
}
```

注：项目 `src/services/api.ts` 已有 `api()` 包装 `invoke()`；本工具保持薄壳一致。

- [ ] **Step 3.2: 提交**

```bash
git add src/utils/sessionResume.ts
git commit -m "feat(frontend): add launchClaudeSessionInTerminal helper"
```

---

## Task 4: i18n 新增 4 个 key × 5 语言

**Files:**
- Modify: `src/i18n/locales/{en,ko,ja,zh-CN,zh-TW}/session.json`

- [ ] **Step 4.1: en/session.json**

在 `src/i18n/locales/en/session.json` 中追加（紧跟 `session.copyResumeCommand` 之后）：

```json
"session.launchInClaudeCode": "Launch in Claude Code",
"session.launchSuccess": "Opened new terminal",
"session.launchError": "Failed to start terminal",
"session.launchUnsupportedPlatform": "Only Windows is supported",
```

- [ ] **Step 4.2: ko/session.json**

```json
"session.launchInClaudeCode": "Claude Code 에서 실행",
"session.launchSuccess": "새 터미널을 열었습니다",
"session.launchError": "터미널 실행 실패",
"session.launchUnsupportedPlatform": "Windows에서만 지원됨",
```

- [ ] **Step 4.3: ja/session.json**

```json
"session.launchInClaudeCode": "Claude Code で起動",
"session.launchSuccess": "新しいターミナルを開きました",
"session.launchError": "ターミナル起動失敗",
"session.launchUnsupportedPlatform": "Windows のみサポート",
```

- [ ] **Step 4.4: zh-CN/session.json**

```json
"session.launchInClaudeCode": "在 Claude Code 中启动",
"session.launchSuccess": "已在新窗口打开",
"session.launchError": "启动终端失败",
"session.launchUnsupportedPlatform": "仅支持 Windows",
```

- [ ] **Step 4.5: zh-TW/session.json**

```json
"session.launchInClaudeCode": "在 Claude Code 中啟動",
"session.launchSuccess": "已在新視窗開啟",
"session.launchError": "啟動終端失敗",
"session.launchUnsupportedPlatform": "僅支援 Windows",
```

- [ ] **Step 4.6: 重新生成类型 + 校验**

Run:
```bash
pnpm run generate:i18n-types
pnpm run i18n:validate
```

Expected: types 文件更新且 validate 报告 "All keys synchronized."（或等价信息）。

- [ ] **Step 4.7: 提交**

```bash
git add src/i18n/locales/ src/i18n/types.generated.ts
git commit -m "feat(i18n): add launchInClaudeCode keys (5 languages)"
```

---

## Task 5: `useSessionEditing` 加 `handleLaunchInTerminal`

**Files:**
- Modify: `src/components/SessionItem/hooks/useSessionEditing.ts`

- [ ] **Step 5.1: 先扩展 import**

在 `useSessionEditing.ts` 顶部 imports 中：

```ts
import {
  getResumeCommand,
  supportsLaunchInTerminal as providerSupportsLaunchInTerminal,
  supportsNativeRename as providerSupportsNativeRename,
  supportsResumeCommand as providerSupportsResumeCommand,
  supportsSessionDeletion as providerSupportsSessionDeletion,
} from "@/utils/providers";
import { launchClaudeSessionInTerminal } from "@/utils/sessionResume";
```

- [ ] **Step 5.2: 加 capability 计算**

在 `const supportsResumeCommand = ...` 行下方追加：

```ts
const supportsLaunchInTerminal = providerSupportsLaunchInTerminal(providerId);
```

- [ ] **Step 5.3: 加 handler**

在 `handleCopyResumeCommand` 之后追加：

```ts
const handleLaunchInTerminal = useCallback(
  async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsContextMenuOpen(false);
    if (!supportsLaunchInTerminal) {
      return;
    }
    const projectPath = useAppStore.getState().selectedProject?.actual_path;
    if (!projectPath) {
      toast.error(t("session.launchError", "Failed to start terminal"));
      return;
    }
    try {
      await launchClaudeSessionInTerminal(projectPath, session.actual_session_id);
      toast.success(t("session.launchSuccess", "Opened new terminal"));
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      let description = raw;
      if (raw === "UNSUPPORTED_PLATFORM") {
        toast.error(
          t("session.launchUnsupportedPlatform", "Only Windows is supported")
        );
        return;
      }
      if (raw === "PATH_NOT_FOUND") {
        description = "Project path no longer exists";
      } else if (raw === "INVALID_SESSION_ID") {
        description = "Invalid session id";
      } else if (raw.startsWith("SPAWN_FAILED:")) {
        description = raw.slice("SPAWN_FAILED:".length);
      }
      toast.error(t("session.launchError", "Failed to start terminal"), {
        description,
      });
    }
  },
  [session.actual_session_id, supportsLaunchInTerminal, t]
);
```

注：错误 description 直接用英文/raw 字符串（仅 4 个稳定字符串，不上 i18n 表，避免维护成本）。如果哥哥后续想要这些也国际化，再扩 i18n 表即可。

- [ ] **Step 5.4: 在 return 对象里暴露**

`useSessionEditing.ts` 的 return 中：

```ts
return {
  // State
  ...
  supportsLaunchInTerminal,  // ← 新增
  ...
  // Actions
  ...
  handleLaunchInTerminal,  // ← 新增
  ...
};
```

- [ ] **Step 5.5: TypeScript 检查**

Run: `pnpm tsc --build .`

Expected: 无错误。

- [ ] **Step 5.6: 提交**

```bash
git add src/components/SessionItem/hooks/useSessionEditing.ts
git commit -m "feat(session): expose handleLaunchInTerminal from useSessionEditing"
```

---

## Task 6: 透传 prop 到 `SessionItem` 子组件

**Files:**
- Modify: `src/components/SessionItem/types.ts`
- Modify: `src/components/SessionItem/SessionItem.tsx`

- [ ] **Step 6.1: 扩展 types.ts**

打开 `src/components/SessionItem/types.ts`。找到 `SessionNameEditorProps` 和 `SessionContextMenuProps`（如在此文件；如不在则继续到对应组件文件的 props interface），在两者中各加：

```ts
supportsLaunchInTerminal: boolean;
onLaunchInTerminal: (e: React.MouseEvent) => void;
```

如果 props interface 是直接定义在组件文件里（之前看到 `SessionContextMenu.tsx` 自己定义了 `SessionContextMenuProps`），就在那两个组件文件分别加。统一原则：哪边声明就在哪边加，不重复。

- [ ] **Step 6.2: 透传到 SessionNameEditor 和 SessionContextMenu**

在 `src/components/SessionItem/SessionItem.tsx` 中：

`<SessionNameEditor ... />` 加两行：
```tsx
supportsLaunchInTerminal={editing.supportsLaunchInTerminal}
onLaunchInTerminal={editing.handleLaunchInTerminal}
```

`<SessionContextMenu ... />` 加两行：
```tsx
supportsLaunchInTerminal={editing.supportsLaunchInTerminal}
onLaunchInTerminal={editing.handleLaunchInTerminal}
```

- [ ] **Step 6.3: TypeScript 检查**

Run: `pnpm tsc --build .`

Expected: 报错出现在 SessionNameEditor.tsx / SessionContextMenu.tsx —— 因为 props 未消费。下两个任务会修。先停在这里。

- [ ] **Step 6.4: 暂不提交，等下游修完一起提**

---

## Task 7: 在右键菜单加 "Launch in Claude Code"

**Files:**
- Modify: `src/components/SessionItem/components/SessionContextMenu.tsx`

- [ ] **Step 7.1: 加 prop 到 SessionContextMenuProps**

打开 `src/components/SessionItem/components/SessionContextMenu.tsx`，在 `SessionContextMenuProps` interface 中加：

```ts
supportsLaunchInTerminal: boolean;
onLaunchInTerminal: (e: React.MouseEvent) => void;
```

- [ ] **Step 7.2: 解构 prop**

在组件函数签名解构里加 `supportsLaunchInTerminal, onLaunchInTerminal`。

- [ ] **Step 7.3: 加 icon import**

调整 lucide-react import，加 `Rocket`：

```tsx
import {
  Pencil,
  RotateCcw,
  Terminal,
  Copy,
  FileText,
  FolderOpen,
  Play,
  Rocket,
  Trash2,
} from "lucide-react";
```

- [ ] **Step 7.4: 渲染菜单项**

在 `{supportsResumeCommand && (... onCopyResumeCommand ...)}` 那一项**之后**追加：

```tsx
{supportsLaunchInTerminal && (
  <button
    type="button"
    role="menuitem"
    onClick={handleAction(onLaunchInTerminal)}
    className={menuItemClass}
  >
    <Rocket className="w-3.5 h-3.5" />
    <span>{t("session.launchInClaudeCode", "Launch in Claude Code")}</span>
  </button>
)}
```

- [ ] **Step 7.5: TypeScript 检查**

Run: `pnpm tsc --build .`

Expected: 该文件错误消除。

---

## Task 8: 在 hover dropdown 加 "Launch in Claude Code"

**Files:**
- Modify: `src/components/SessionItem/components/SessionNameEditor.tsx`

- [ ] **Step 8.1: 加 prop 到 SessionNameEditorProps**

打开 `src/components/SessionItem/components/SessionNameEditor.tsx`。如果 props interface 在 `types.ts`，去那里加；如果在本文件内联，就在本文件加：

```ts
supportsLaunchInTerminal: boolean;
onLaunchInTerminal: (e: React.MouseEvent) => void;
```

- [ ] **Step 8.2: 解构 prop**

组件函数签名中加 `supportsLaunchInTerminal, onLaunchInTerminal`。

- [ ] **Step 8.3: 加 icon import**

import lucide-react 部分加 `Rocket`：

```tsx
import {
  Pencil,
  X,
  Check,
  RotateCcw,
  Link2,
  Terminal,
  Copy,
  FileText,
  FolderOpen,
  Play,
  Rocket,
  Trash2,
} from "lucide-react";
```

- [ ] **Step 8.4: 渲染 DropdownMenuItem**

在现有 `{supportsResumeCommand && (<DropdownMenuItem onClick={onCopyResumeCommand}>...)}` 之后插入：

```tsx
{supportsLaunchInTerminal && (
  <DropdownMenuItem onClick={onLaunchInTerminal}>
    <Rocket className="w-3 h-3 mr-2" />
    {t("session.launchInClaudeCode", "Launch in Claude Code")}
  </DropdownMenuItem>
)}
```

- [ ] **Step 8.5: TypeScript 检查 + 测试**

Run: `pnpm tsc --build .`

Expected: 无错误（Task 6 ~ 8 修完之后整个链路通了）。

- [ ] **Step 8.6: 提交 Task 6/7/8 累积改动**

```bash
git add src/components/SessionItem/
git commit -m "feat(session): add 'Launch in Claude Code' menu item"
```

---

## Task 9: 扩展 `useSessionEditing` 测试

**Files:**
- Modify: `src/test/useSessionEditing.test.tsx`

- [ ] **Step 9.1: 看现有测试结构**

Run: `head -60 src/test/useSessionEditing.test.tsx`（人工查看，了解既有 mock 风格）。

- [ ] **Step 9.2: 加新测试用例**

在测试文件合适位置追加（命名空间根据既有风格）：

```tsx
import { launchClaudeSessionInTerminal } from "@/utils/sessionResume";

vi.mock("@/utils/sessionResume", () => ({
  launchClaudeSessionInTerminal: vi.fn(),
}));

describe("handleLaunchInTerminal", () => {
  beforeEach(() => {
    vi.mocked(launchClaudeSessionInTerminal).mockReset();
    useAppStore.setState({
      selectedProject: {
        // 仅 actual_path 在 hook 中被读取
        actual_path: "D:\\github\\demo",
        name: "demo",
        provider: "claude",
        actual_session_id: "x",
        session_count: 1,
      } as never,
    });
  });

  it("calls launchClaudeSessionInTerminal with project path + session id for claude", async () => {
    const session = makeSession({ provider: "claude", actual_session_id: "abc123" });
    const { result } = renderHook(() => useSessionEditing(session));

    await act(async () => {
      await result.current.handleLaunchInTerminal({
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
    });

    expect(launchClaudeSessionInTerminal).toHaveBeenCalledWith(
      "D:\\github\\demo",
      "abc123"
    );
  });

  it("does nothing for non-claude providers", async () => {
    const session = makeSession({ provider: "codex", actual_session_id: "abc123" });
    const { result } = renderHook(() => useSessionEditing(session));

    await act(async () => {
      await result.current.handleLaunchInTerminal({
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
    });

    expect(launchClaudeSessionInTerminal).not.toHaveBeenCalled();
  });
});
```

注：`makeSession` 是该测试文件已有的工厂函数；如未定义，按文件中其他 describe 的实际写法复制写法即可。`renderHook`、`act` 来自 `@testing-library/react`。

- [ ] **Step 9.3: 跑测试**

Run: `pnpm vitest run src/test/useSessionEditing.test.tsx`

Expected: 全部 PASS。

- [ ] **Step 9.4: 提交**

```bash
git add src/test/useSessionEditing.test.tsx
git commit -m "test(session): cover handleLaunchInTerminal in useSessionEditing"
```

---

## Task 10: `pathDisplay` 工具 + 单测

**Files:**
- Create: `src/utils/pathDisplay.ts`
- Create: `src/utils/__tests__/pathDisplay.test.ts`

- [ ] **Step 10.1: 先写失败的单测**

新建 `src/utils/__tests__/pathDisplay.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { getProjectDisplayName } from "../pathDisplay";

describe("getProjectDisplayName", () => {
  it("returns last segment of Windows path", () => {
    expect(
      getProjectDisplayName("D:\\github\\claude-code-history-viewer", "fallback")
    ).toBe("claude-code-history-viewer");
  });

  it("returns last segment of POSIX path", () => {
    expect(
      getProjectDisplayName("/Users/jack/projects/demo", "fallback")
    ).toBe("demo");
  });

  it("strips trailing separators", () => {
    expect(getProjectDisplayName("D:\\foo\\bar\\", "fallback")).toBe("bar");
    expect(getProjectDisplayName("/foo/bar/", "fallback")).toBe("bar");
  });

  it("falls back when actualPath is empty or nullish", () => {
    expect(getProjectDisplayName(null, "fallback")).toBe("fallback");
    expect(getProjectDisplayName(undefined, "fallback")).toBe("fallback");
    expect(getProjectDisplayName("", "fallback")).toBe("fallback");
    expect(getProjectDisplayName("   ", "fallback")).toBe("fallback");
  });

  it("falls back when path has no segments left after stripping separators", () => {
    expect(getProjectDisplayName("/", "fallback")).toBe("fallback");
    expect(getProjectDisplayName("\\\\", "fallback")).toBe("fallback");
  });
});
```

- [ ] **Step 10.2: 跑测试看失败**

Run: `pnpm vitest run src/utils/__tests__/pathDisplay.test.ts`

Expected: 找不到 module 报错。

- [ ] **Step 10.3: 实现**

新建 `src/utils/pathDisplay.ts`：

```ts
/**
 * 从绝对路径取最后一级目录名作为展示名。空 / 无可用段时回退到 fallbackName。
 * 同时识别 Windows ("\") 和 POSIX ("/") 分隔符。
 */
export function getProjectDisplayName(
  actualPath: string | null | undefined,
  fallbackName: string
): string {
  if (!actualPath || !actualPath.trim()) {
    return fallbackName;
  }
  const segments = actualPath.split(/[\\/]/).filter((s) => s.length > 0);
  if (segments.length === 0) {
    return fallbackName;
  }
  return segments[segments.length - 1];
}
```

- [ ] **Step 10.4: 跑测试 PASS**

Run: `pnpm vitest run src/utils/__tests__/pathDisplay.test.ts`

Expected: 5 test passed.

- [ ] **Step 10.5: 提交**

```bash
git add src/utils/pathDisplay.ts src/utils/__tests__/pathDisplay.test.ts
git commit -m "feat(utils): add getProjectDisplayName helper"
```

---

## Task 11: ProjectItem 接入 pathDisplay + 移除 hover 抖动

**Files:**
- Modify: `src/components/ProjectTree/components/ProjectItem.tsx`

- [ ] **Step 11.1: import 工具函数**

在 `ProjectItem.tsx` 顶部 import 中加：

```ts
import { getProjectDisplayName } from "../../../utils/pathDisplay";
```

- [ ] **Step 11.2: 改 displayName 计算**

替换 `const displayName = isMain ? ... : project.name;` 整段为：

```ts
const displayName = isMain
  ? t("project.main", "main")
  : isWorktree
    ? getWorktreeLabel(project.actual_path)
    : getProjectDisplayName(project.actual_path, project.name);
```

- [ ] **Step 11.3: 移除 hover 抖动**

在 `className={cn(...)}` 的 className 数组中找到下面两行（约 line 70-71）：

```tsx
: "hover:bg-accent/8 hover:pl-5 border-l-2 border-transparent",
!isGrouped && isExpanded && "bg-accent/10 border-l-accent pl-5",
```

替换为：

```tsx
: "hover:bg-accent/8 border-l-2 border-transparent",
!isGrouped && isExpanded && "bg-accent/10 border-l-accent",
```

去掉 `hover:pl-5` 和展开态的 `pl-5`，hover/expanded 不再改 padding（保留 border-left 颜色变化作为选中提示）。

- [ ] **Step 11.4: TS 检查**

Run: `pnpm tsc --build .`

Expected: 无错误。

- [ ] **Step 11.5: 提交**

```bash
git add src/components/ProjectTree/components/ProjectItem.tsx
git commit -m "fix(project-tree): show real path basename, drop hover jitter"
```

---

## Task 12: Header 简化（删 appDescription 副标题）

**Files:**
- Modify: `src/layouts/Header/Header.tsx`

- [ ] **Step 12.1: 删第二行 `<p>`**

找到 `Header.tsx` 中（约 line 124-126）：

```tsx
) : (
  <p className="text-2xs text-muted-foreground hidden md:block">{t('common.appDescription')}</p>
)}
```

改为：

```tsx
) : null}
```

效果：未选 session 时不再显示副标题；选了 session 时仍显示 session summary。

- [ ] **Step 12.2: TS 检查**

Run: `pnpm tsc --build .`

Expected: 无错误。

- [ ] **Step 12.3: 提交**

```bash
git add src/layouts/Header/Header.tsx
git commit -m "fix(header): drop appDescription subtitle when no session"
```

---

## Task 13: 最终质量门

按项目 CLAUDE.md「Phase 1 品质检验」清单跑全套，全部 PASS 才算交付。

- [ ] **Step 13.1: 同步依赖**

```bash
pnpm install
```

- [ ] **Step 13.2: TypeScript build**

```bash
pnpm tsc --build .
```

- [ ] **Step 13.3: 前端测试**

```bash
pnpm vitest run --reporter=verbose
```

Expected: 全 PASS，包括新加的 `pathDisplay.test.ts` 和扩展的 `useSessionEditing.test.tsx`。

- [ ] **Step 13.4: ESLint**

```bash
pnpm lint
```

Expected: 无 error / warning。

- [ ] **Step 13.5: Rust 测试**

```bash
cd src-tauri && cargo test -- --test-threads=1 && cd ..
```

Expected: 全 PASS。

- [ ] **Step 13.6: Rust clippy**

```bash
cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings && cd ..
```

- [ ] **Step 13.7: Rust fmt**

```bash
cd src-tauri && cargo fmt --all -- --check && cd ..
```

- [ ] **Step 13.8: i18n validate**

```bash
pnpm run i18n:validate
```

Expected: 报告 5 个语言键全同步。

- [ ] **Step 13.9: 手测清单（哥哥本地，跑 `just dev`）**

启动 dev：`just dev`

- [ ] 找一个 Claude Code provider 的会话，右键 → 出现 "在 Claude Code 中启动" 菜单项
- [ ] 点击后弹出新的 PowerShell 窗口
- [ ] 新窗口 cwd 是项目目录（`pwd` 验证）
- [ ] 新窗口自动跑 `claude --resume <session-id>` 并进入会话
- [ ] 关闭原 viewer 窗口，新 PowerShell 窗口仍存活
- [ ] 选一个非 claude 会话（如 codex），右键菜单**不出现** "在 Claude Code 中启动"
- [ ] 左侧项目名从 `D--github-claude-code-history-viewer` 变成 `claude-code-history-viewer`
- [ ] hover 项目名时不再左右抖动
- [ ] 没选 session 时 Header 不再显示副标题

- [ ] **Step 13.10: 推到哥哥的 fork**

哥哥提供 fork URL 后，加 remote 并推：

```bash
git remote add fork <FORK_URL>
git push -u fork feature/resume-and-ui-polish
```

然后在 GitHub 上发 PR：base = `<fork>/develop`, head = `<fork>/feature/resume-and-ui-polish`。

---

## Notes for Engineer

- 项目用 PowerShell 优先（哥哥个人偏好），不要换成 bash
- `cargo test` 必须 `--test-threads=1`（settings 测试用 env::set_var("HOME") 全局态）
- 后端错误用 prefix 字符串约定（如 `SPAWN_FAILED:<reason>`），前端按 prefix 解析为 toast。无国际化的错误 prefix 透传明文是允许的
- 不要重做 `Copy Resume Command` —— 那是既有功能；本次只**新增** Launch 入口
- 单测中 `useAppStore.setState({ selectedProject: ... })` 是项目里 hook 测试既有模式（如 hook 改用其他方式获取 project path，按实际为准）
