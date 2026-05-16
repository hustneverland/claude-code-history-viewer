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
