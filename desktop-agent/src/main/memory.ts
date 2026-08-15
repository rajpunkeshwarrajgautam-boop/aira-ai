import Store from 'electron-store'
import type { AppSettings } from './config'
import { embed } from './model'
import type { MemoryRecord } from './types'

interface MemorySchema {
  records: MemoryRecord[]
}

const memory = new Store<MemorySchema>({ name: 'memory', defaults: { records: [] } })

function cosine(a?: number[], b?: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0
  let dot = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0
}

function lexicalScore(text: string, query: string): number {
  const hay = text.toLowerCase()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return 0
  return terms.reduce((score, term) => score + (hay.includes(term) ? 1 : 0), 0) / terms.length
}

export async function addMemory(settings: AppSettings, text: string, tags: string[] = []): Promise<MemoryRecord> {
  const clean = text.trim().slice(0, 12_000)
  if (!clean) throw new Error('Memory text is empty.')
  let vector: number[] | undefined
  if (settings.memoryRagEnabled) {
    try {
      vector = (await embed(settings, clean))[0]
    } catch {
      vector = undefined
    }
  }
  const record: MemoryRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: clean,
    tags: tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
    createdAt: new Date().toISOString(),
    embedding: vector
  }
  const records = memory.get('records', [])
  memory.set('records', [record, ...records].slice(0, 1000))
  return record
}

export async function searchMemory(settings: AppSettings, query: string, limit = 8): Promise<MemoryRecord[]> {
  const records = memory.get('records', [])
  if (!query.trim()) return records.slice(0, limit)
  let qVector: number[] | undefined
  if (settings.memoryRagEnabled) {
    try {
      qVector = (await embed(settings, query))[0]
    } catch {
      qVector = undefined
    }
  }
  return records
    .map((record) => ({ record, score: Math.max(lexicalScore(record.text, query), cosine(record.embedding, qVector)) }))
    .filter((item) => item.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 30)))
    .map((item) => item.record)
}

export function listMemories(limit = 100): MemoryRecord[] {
  return memory.get('records', []).slice(0, Math.max(1, Math.min(limit, 500)))
}

export function deleteMemory(id: string): boolean {
  const records = memory.get('records', [])
  const next = records.filter((record) => record.id !== id)
  memory.set('records', next)
  return next.length !== records.length
}

export { cosine }
