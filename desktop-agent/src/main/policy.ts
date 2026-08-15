import path from 'path'

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}

export function isPathInside(root: string, target: string): boolean {
  const base = path.resolve(root)
  const full = path.resolve(target)
  const rel = path.relative(base, full)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function clampAgentSteps(value: number): number {
  if (!Number.isFinite(value)) return 12
  return Math.max(4, Math.min(30, Math.round(value)))
}
