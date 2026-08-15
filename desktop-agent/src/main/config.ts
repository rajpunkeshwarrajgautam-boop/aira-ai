import Store from 'electron-store'
import os from 'os'
import path from 'path'
import type { ProviderKind } from './types'

export interface AppSettings {
  provider: ProviderKind
  ollamaUrl: string
  model: string
  visionModel: string
  embeddingModel: string
  remoteBaseUrl: string
  remoteModel: string
  workspaceRoot: string
  voiceEnabled: boolean
  continuousVoice: boolean
  wakeWord: string
  autoSpeak: boolean
  browserEnabled: boolean
  computerControlEnabled: boolean
  memoryRagEnabled: boolean
  autoUpdate: boolean
  maxAgentSteps: number
}

const defaults: AppSettings = {
  provider: 'ollama',
  ollamaUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b',
  visionModel: 'qwen3-vl:8b',
  embeddingModel: 'embeddinggemma',
  remoteBaseUrl: 'https://api.openai.com/v1',
  remoteModel: 'gpt-5-mini',
  workspaceRoot: path.join(os.homedir(), 'AIRA Workspace'),
  voiceEnabled: true,
  continuousVoice: false,
  wakeWord: 'aira',
  autoSpeak: false,
  browserEnabled: true,
  computerControlEnabled: true,
  memoryRagEnabled: true,
  autoUpdate: true,
  maxAgentSteps: 12
}

const store = new Store<AppSettings>({ name: 'settings', defaults })

function cleanUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function getSettings(): AppSettings {
  return {
    provider: store.get('provider'),
    ollamaUrl: store.get('ollamaUrl'),
    model: store.get('model'),
    visionModel: store.get('visionModel'),
    embeddingModel: store.get('embeddingModel'),
    remoteBaseUrl: store.get('remoteBaseUrl'),
    remoteModel: store.get('remoteModel'),
    workspaceRoot: store.get('workspaceRoot'),
    voiceEnabled: store.get('voiceEnabled'),
    continuousVoice: store.get('continuousVoice'),
    wakeWord: store.get('wakeWord'),
    autoSpeak: store.get('autoSpeak'),
    browserEnabled: store.get('browserEnabled'),
    computerControlEnabled: store.get('computerControlEnabled'),
    memoryRagEnabled: store.get('memoryRagEnabled'),
    autoUpdate: store.get('autoUpdate'),
    maxAgentSteps: store.get('maxAgentSteps')
  }
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  if (patch.provider === 'ollama' || patch.provider === 'openai-compatible') store.set('provider', patch.provider)
  if (typeof patch.ollamaUrl === 'string' && patch.ollamaUrl.trim()) store.set('ollamaUrl', cleanUrl(patch.ollamaUrl))
  if (typeof patch.model === 'string' && patch.model.trim()) store.set('model', patch.model.trim())
  if (typeof patch.visionModel === 'string' && patch.visionModel.trim()) store.set('visionModel', patch.visionModel.trim())
  if (typeof patch.embeddingModel === 'string' && patch.embeddingModel.trim()) store.set('embeddingModel', patch.embeddingModel.trim())
  if (typeof patch.remoteBaseUrl === 'string' && patch.remoteBaseUrl.trim()) store.set('remoteBaseUrl', cleanUrl(patch.remoteBaseUrl))
  if (typeof patch.remoteModel === 'string' && patch.remoteModel.trim()) store.set('remoteModel', patch.remoteModel.trim())
  if (typeof patch.workspaceRoot === 'string' && patch.workspaceRoot.trim()) store.set('workspaceRoot', path.resolve(patch.workspaceRoot.trim()))
  if (typeof patch.voiceEnabled === 'boolean') store.set('voiceEnabled', patch.voiceEnabled)
  if (typeof patch.continuousVoice === 'boolean') store.set('continuousVoice', patch.continuousVoice)
  if (typeof patch.wakeWord === 'string') store.set('wakeWord', patch.wakeWord.trim().slice(0, 40) || 'aira')
  if (typeof patch.autoSpeak === 'boolean') store.set('autoSpeak', patch.autoSpeak)
  if (typeof patch.browserEnabled === 'boolean') store.set('browserEnabled', patch.browserEnabled)
  if (typeof patch.computerControlEnabled === 'boolean') store.set('computerControlEnabled', patch.computerControlEnabled)
  if (typeof patch.memoryRagEnabled === 'boolean') store.set('memoryRagEnabled', patch.memoryRagEnabled)
  if (typeof patch.autoUpdate === 'boolean') store.set('autoUpdate', patch.autoUpdate)
  if (typeof patch.maxAgentSteps === 'number' && Number.isFinite(patch.maxAgentSteps)) {
    store.set('maxAgentSteps', Math.max(4, Math.min(30, Math.round(patch.maxAgentSteps))))
  }
  return getSettings()
}
