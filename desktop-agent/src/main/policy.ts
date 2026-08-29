import { promises as dns } from 'dns'
import { isIP } from 'net'
import path from 'path'

const SECRET_KEY = /(authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)/i

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim())
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

function ipv4Parts(address: string): number[] | null {
  if (isIP(address) !== 4) return null
  const parts = address.split('.').map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null
}

export function isPublicNetworkAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, '')
  const v4 = ipv4Parts(normalized)
  if (v4) {
    const [a, b, c] = v4
    if (a === 0 || a === 10 || a === 127) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 0 && c === 0) return false
    if (a === 192 && b === 168) return false
    if (a === 198 && (b === 18 || b === 19)) return false
    if (a >= 224) return false
    return true
  }
  if (isIP(normalized) === 6) {
    if (normalized === '::' || normalized === '::1') return false
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return false
    if (/^fe[89ab]/.test(normalized)) return false
    if (normalized.startsWith('ff')) return false
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPublicNetworkAddress(mapped[1])
    return true
  }
  return false
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  if (!isHttpUrl(raw)) throw new Error('Only credential-free HTTP(S) URLs are allowed.')
  const url = new URL(raw.trim())
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Local/private browser destinations are blocked.')
  }
  if (isIP(hostname)) {
    if (!isPublicNetworkAddress(hostname)) throw new Error('Local/private browser destinations are blocked.')
    return url
  }
  let addresses: { address: string }[]
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('Browser destination could not be resolved safely.')
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicNetworkAddress(address))) {
    throw new Error('Browser destination resolved to a blocked network address.')
  }
  return url
}

function auditShape(value: unknown, key = '', depth = 0): unknown {
  if (SECRET_KEY.test(key)) return '[redacted]'
  if (depth > 4) return '[truncated]'
  if (typeof value === 'string') return `<string:${value.length}>`
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return { type: 'array', length: value.length, sample: value.slice(0, 5).map((entry) => auditShape(entry, key, depth + 1)) }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([childKey, child]) => [childKey, auditShape(child, childKey, depth + 1)]))
  }
  return String(value)
}

export function sanitizeAuditSummary(summary: string | undefined): string | undefined {
  if (!summary) return summary
  try {
    return JSON.stringify(auditShape(JSON.parse(summary))).slice(0, 2000)
  } catch {
    return summary
      .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(/(?:sk|nvapi|ghp|github_pat|xox[baprs])[-_a-z0-9]+/gi, '[redacted]')
      .replace(/((?:token|secret|password|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
      .slice(0, 1000)
  }
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
