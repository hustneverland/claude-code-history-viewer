/**
 * 优先用绝对路径（actualPath）作为左侧栏项目展示名，方便一眼看出项目位置。
 * 路径缺失时回退到 fallbackName（旧 encode 形式或 worktree 标签）。
 */
export function getProjectDisplayName(
  actualPath: string | null | undefined,
  fallbackName: string
): string {
  if (!actualPath || !actualPath.trim()) {
    return fallbackName;
  }
  return actualPath.trim();
}
