import Store from 'electron-store'
import { sanitizeAuditSummary } from './policy'

interface AuditEvent {
  id: string
  at: string
  type: string
  tool?: string
  approved?: boolean
  summary?: string
}

interface AuditSchema {
  events: AuditEvent[]
}

const audit = new Store<AuditSchema>({ name: 'audit', defaults: { events: [] } })

export function logAudit(event: Omit<AuditEvent, 'id' | 'at'>): void {
  const current = audit.get('events', [])
  const next: AuditEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...event,
    summary: sanitizeAuditSummary(event.summary)
  }
  audit.set('events', [next, ...current].slice(0, 1000))
}

export function getAudit(limit = 100): AuditEvent[] {
  return audit.get('events', []).slice(0, Math.max(1, Math.min(limit, 500)))
}
