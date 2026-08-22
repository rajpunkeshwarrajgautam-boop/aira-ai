import { promises as fs } from 'fs'
import type { AppSettings } from './config'
import {
  chooseOpenAICompatibleModel,
  isLoopbackOpenAICompatibleUrl,
  openAICompatibleAuthHeaders,
  openAICompatibleChatUrl,
  openAICompatibleModelsUrl
} from './openai-compatible'
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
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`Model endpoint returned ${response.status}: ${(await response.text()).slice(0, 2000)}`)
    return await response.json()
  } finally {
    done()
  }
}

function parseDecision(text: string): AgentDecision {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const json = start >= 0 && end > start ? text.slice(start, end + 1) : text
  const parsed = JSON.parse(json) as AgentDecision
  if (parsed.type !== 'tool' && parsed.type !== 'final') throw new Error('Unsupported agent decision.')
  return parsed
}

function compatibleHeaders(settings: AppSettings): Record<string, string> {
  return openAICompatibleAuthHeaders(settings.remoteBaseUrl, getSecret('remoteApiKey'))
}

function openAICompatibleMessages(messages: ChatMessage[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'user' as const, content: `TOOL RESULT (runtime evidence):\n${message.content}` }
    }
    return { role: message.role, content: message.content }
  })
}

async function compatibleModels(settings: AppSettings): Promise<string[]> {
  const response = await fetch(openAICompatibleModelsUrl(settings.remoteBaseUrl), {
    headers: compatibleHeaders(settings),
    signal: AbortSignal.timeout(8_000)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = (await response.json()) as { data?: Array<{ id?: string }> }
  return (data.data || []).map((model) => model.id || '').filter(Boolean)
}

async function compatibleModel(settings: AppSettings): Promise<string> {
  if (!isLoopbackOpenAICompatibleUrl(settings.remoteBaseUrl)) return settings.remoteModel
  try {
    return chooseOpenAICompatibleModel(settings.remoteModel, await compatibleModels(settings))
  } catch {
    return settings.remoteModel
  }
}

function shouldRetryWithoutResponseFormat(settings: AppSettings, error: unknown): boolean {
  if (!isLoopbackOpenAICompatibleUrl(settings.remoteBaseUrl)) return false
  const message = error instanceof Error ? error.message : String(error)
  return /response[_ -]?format|json[_ -]?object|\b400\b|\b415\b|\b422\b/i.test(message)
}

export async function callDecision(settings: AppSettings, messages: ChatMessage[]): Promise<AgentDecision> {
  if (settings.provider === 'openai-compatible') {
    const body = {
      model: await compatibleModel(settings),
      messages: openAICompatibleMessages(messages),
      temperature: 0.2,
      response_format: { type: 'json_object' }
    }
    let data: any
    try {
      data = await postJson(openAICompatibleChatUrl(settings.remoteBaseUrl), body, compatibleHeaders(settings))
    } catch (error) {
      if (!shouldRetryWithoutResponseFormat(settings, error)) throw error
      const fallbackBody = {
        model: body.model,
        messages: body.messages,
        temperature: body.temperature
      }
      data = await postJson(openAICompatibleChatUrl(settings.remoteBaseUrl), fallbackBody, compatibleHeaders(settings))
    }
    return parseDecision(String(data?.choices?.[0]?.message?.content || ''))
  }

  const data = await postJson(`${settings.ollamaUrl}/api/chat`, {
    model: settings.model,
    stream: false,
    format: DECISION_SCHEMA,
    messages: messages.map(({ role, content }) => ({ role, content })),
    options: { temperature: 0.2 }
  })
  return parseDecision(String(data?.message?.content || ''))
}

export async function chatText(settings: AppSettings, messages: ChatMessage[]): Promise<string> {
  if (settings.provider === 'openai-compatible') {
    const data = await postJson(
      openAICompatibleChatUrl(settings.remoteBaseUrl),
      {
        model: await compatibleModel(settings),
        messages: openAICompatibleMessages(messages),
        temperature: 0.3
      },
      compatibleHeaders(settings)
    )
    return String(data?.choices?.[0]?.message?.content || '')
  }

  const data = await postJson(`${settings.ollamaUrl}/api/chat`, {
    model: settings.model,
    stream: false,
    messages: messages.map(({ role, content }) => ({ role, content })),
    options: { temperature: 0.3 }
  })
  return String(data?.message?.content || '')
}

export async function visionText(settings: AppSettings, imagePath: string, prompt: string): Promise<string> {
  const base64 = (await fs.readFile(imagePath)).toString('base64')
  const data = await postJson(`${settings.ollamaUrl}/api/chat`, {
    model: settings.visionModel,
    stream: false,
    messages: [{ role: 'user', content: prompt, images: [base64] }],
    options: { temperature: 0.1 }
  })
  return String(data?.message?.content || '')
}

export async function visionJson<T>(settings: AppSettings, imagePath: string, prompt: string, schema: Record<string, unknown>): Promise<T> {
  const base64 = (await fs.readFile(imagePath)).toString('base64')
  const data = await postJson(`${settings.ollamaUrl}/api/chat`, {
    model: settings.visionModel,
    stream: false,
    format: schema,
    messages: [{ role: 'user', content: prompt, images: [base64] }],
    options: { temperature: 0 }
  })
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
    return { ok: true, models: (data.models || []).map((model) => model.name || '').filter(Boolean) }
  } catch (error) {
    return { ok: false, models: [], error: error instanceof Error ? error.message : String(error) }
  }
}

export async function checkOpenAICompatible(settings: AppSettings): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    return { ok: true, models: await compatibleModels(settings) }
  } catch (error) {
    return { ok: false, models: [], error: error instanceof Error ? error.message : String(error) }
  }
}

export async function pullOllamaModel(settings: AppSettings, model: string): Promise<boolean> {
  const data = await postJson(`${settings.ollamaUrl}/api/pull`, { model, stream: false })
  return data?.status === 'success'
}
