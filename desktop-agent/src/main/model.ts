import { promises as fs } from 'fs'
import type { AppSettings } from './config'
import { getSecret } from './secrets'
import type { AgentDecision, ChatMessage } from './types'

const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['final', 'tool'] },
    content: { type: 'string' },
    tool: { type: 'string' },
    args: { type: 'object' },
    reasoning: { type: 'string' },
    plan: { type: 'array', items: { type: 'string' } }
  },
  required: ['type']
}

function withTimeout(ms = 180_000): { controller: AbortController; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { controller, done: () => clearTimeout(timer) }
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const { controller, done } = withTimeout()
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal })
    if (!response.ok) throw new Error(`Model endpoint returned ${response.status}: ${(await response.text()).slice(0, 2000)}`)
    return await response.json()
  } finally { done() }
}

function parseDecision(text: string): AgentDecision {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}')
  const json = start >= 0 && end > start ? text.slice(start, end + 1) : text
  const parsed = JSON.parse(json) as AgentDecision
  if (parsed.type !== 'tool' && parsed.type !== 'final') throw new Error('Unsupported agent decision.')
  return parsed
}

export async function callDecision(settings: AppSettings, messages: ChatMessage[]): Promise<AgentDecision> {
  if (settings.provider === 'openai-compatible') {
    const key = getSecret('remoteApiKey')
    if (!key) throw new Error('Remote API key is not configured in the encrypted vault.')
    const data = await postJson(`${settings.remoteBaseUrl}/chat/completions`, { model: settings.remoteModel, messages: messages.map(({ role, content }) => ({ role, content })), temperature: 0.2, response_format: { type: 'json_object' } }, { Authorization: `Bearer ${key}` })
    return parseDecision(String(data?.choices?.[0]?.message?.content || ''))
  }
  const data = await postJson(`${settings.ollamaUrl}/api/chat`, { model: settings.model, stream: false, format: DECISION_SCHEMA, messages: messages.map(({ role, content }) => ({ role, content })), options: { temperature: 0.2 } })
  return parseDecision(String(data?.message?.content || ''))
}

export async function chatText(settings: AppSettings, messages: ChatMessage[]): Promise<string> {
  if (settings.provider === 'openai-compatible') {
    const key = getSecret('remoteApiKey')
    if (!key) throw new Error('Remote API key is not configured.')
    const data = await postJson(`${settings.remoteBaseUrl}/chat/completions`, { model: settings.remoteModel, messages: messages.map(({ role, content }) => ({ role, content })), temperature: 0.3 }, { Authorization: `Bearer ${key}` })
    return String(data?.choices?.[0]?.message?.content || '')
  }
  const data = await postJson(`${settings.ollamaUrl}/api/chat`, { model: settings.model, stream: false, messages: messages.map(({ role, content }) => ({ role, content })), options: { temperature: 0.3 } })
  return String(data?.message?.content || '')
}

export async function visionText(settings: AppSettings, imagePath: string, prompt: string): Promise<string> {
  const base64 = (await fs.readFile(imagePath)).toString('base64')
  const data = await postJson(`${settings.ollamaUrl}/api/chat`, { model: settings.visionModel, stream: false, messages: [{ role: 'user', content: prompt, images: [base64] }], options: { temperature: 0.1 } })
  return String(data?.message?.content || '')
}

export async function visionJson<T>(settings: AppSettings, imagePath: string, prompt: string, schema: Record<string, unknown>): Promise<T> {
  const base64 = (await fs.readFile(imagePath)).toString('base64')
  const data = await postJson(`${settings.ollamaUrl}/api/chat`, { model: settings.visionModel, stream: false, format: schema, messages: [{ role: 'user', content: prompt, images: [base64] }], options: { temperature: 0 } })
  return JSON.parse(String(data?.message?.content || '{}')) as T
}

export async function embed(settings: AppSettings, input: string | string[]): Promise<number[][]> {
  const data = await postJson(`${settings.ollamaUrl}/api/embed`, { model: settings.embeddingModel, input })
  return Array.isArray(data?.embeddings) ? data.embeddings : []
}

export async function checkOllama(settings: AppSettings): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const response = await fetch(`${settings.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return { ok: false, models: [], error: `HTTP ${response.status}` }
    const data = (await response.json()) as { models?: Array<{ name?: string }> }
    return { ok: true, models: (data.models || []).map((m) => m.name || '').filter(Boolean) }
  } catch (error) { return { ok: false, models: [], error: error instanceof Error ? error.message : String(error) } }
}

export async function pullOllamaModel(settings: AppSettings, model: string): Promise<boolean> {
  const data = await postJson(`${settings.ollamaUrl}/api/pull`, { model, stream: false })
  return data?.status === 'success'
}
