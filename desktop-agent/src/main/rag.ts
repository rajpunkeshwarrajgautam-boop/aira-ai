import Store from 'electron-store'
import { promises as fs } from 'fs'
import path from 'path'
import type { AppSettings } from './config'
import { embed } from './model'
import { cosine } from './memory'
import type { RagChunk } from './types'

interface RagSchema { chunks: RagChunk[] }
const rag = new Store<RagSchema>({ name: 'rag-index', defaults: { chunks: [] } })
const TEXT_EXTENSIONS = new Set(['.txt','.md','.mdx','.json','.yaml','.yml','.toml','.ini','.csv','.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.rs','.go','.java','.html','.css','.scss','.sql','.sh','.ps1','.xml'])

function chunkText(text: string, max = 2200): string[] {
  const clean = text.replace(/\r\n/g, '\n'); const chunks: string[] = []; let start = 0
  while (start < clean.length) {
    let end = Math.min(clean.length, start + max)
    if (end < clean.length) { const newline = clean.lastIndexOf('\n', end); if (newline > start + max / 2) end = newline }
    const chunk = clean.slice(start, end).trim(); if (chunk) chunks.push(chunk); start = Math.max(end, start + 1)
  }
  return chunks
}
async function walk(dir: string, root: string, files: string[], cap: number): Promise<void> {
  if (files.length >= cap) return
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (files.length >= cap) break
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'out') continue
    const full = path.join(dir, entry.name); const rel = path.relative(root, full)
    if (entry.isDirectory()) await walk(full, root, files, cap)
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(rel)
  }
}
export async function indexWorkspace(settings: AppSettings): Promise<{ files: number; chunks: number }> {
  const root = path.resolve(settings.workspaceRoot); await fs.mkdir(root, { recursive: true }); const files: string[] = []; await walk(root, root, files, 500); const chunks: RagChunk[] = []
  for (const rel of files) {
    const full = path.join(root, rel); const stat = await fs.stat(full); if (stat.size > 1_500_000) continue
    let text = ''; try { text = await fs.readFile(full, 'utf8') } catch { continue }
    const parts = chunkText(text).slice(0, 60); if (!parts.length) continue
    let vectors: number[][] = []; if (settings.memoryRagEnabled) { try { vectors = await embed(settings, parts) } catch { vectors = [] } }
    parts.forEach((content, index) => chunks.push({ id: `${rel}:${index}`, path: rel, content, index, embedding: vectors[index], updatedAt: stat.mtime.toISOString() }))
    if (chunks.length >= 8000) break
  }
  rag.set('chunks', chunks.slice(0, 8000)); return { files: files.length, chunks: chunks.length }
}
export async function searchWorkspace(settings: AppSettings, query: string, limit = 8): Promise<RagChunk[]> {
  const chunks = rag.get('chunks', []); if (!chunks.length) return []
  let vector: number[] | undefined; try { vector = (await embed(settings, query))[0] } catch { vector = undefined }
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return chunks.map((chunk) => { const lexical = terms.reduce((n, term) => n + (chunk.content.toLowerCase().includes(term) ? 1 : 0), 0) / Math.max(1, terms.length); return { chunk, score: Math.max(lexical, cosine(chunk.embedding, vector)) } }).filter((item) => item.score > 0.05).sort((a,b) => b.score-a.score).slice(0, Math.max(1,Math.min(limit,20))).map((item)=>item.chunk)
}
export function ragStatus(): { chunks: number; files: number } { const chunks = rag.get('chunks', []); return { chunks: chunks.length, files: new Set(chunks.map((c) => c.path)).size } }
