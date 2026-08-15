export type ProviderKind = 'ollama' | 'openai-compatible'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface AgentRequest {
  text: string
  history?: ChatMessage[]
  images?: string[]
  unattended?: boolean
}

export interface AgentStep {
  tool: string
  summary: string
  ok: boolean
}

export interface AgentReply {
  text: string
  steps: AgentStep[]
  plan?: string[]
}

export type AgentDecision =
  | { type: 'final'; content: string; plan?: string[] }
  | { type: 'tool'; tool: string; args?: Record<string, unknown>; reasoning?: string; plan?: string[] }

export interface ApprovalRequest {
  id: string
  title: string
  details: string
  risk: 'low' | 'medium' | 'high'
}

export interface ToolContext {
  approve: (title: string, details: string, risk?: 'low' | 'medium' | 'high') => Promise<boolean>
  unattended?: boolean
}

export interface ToolDescriptor {
  name: string
  description: string
  requiresApproval: boolean
  risk: 'low' | 'medium' | 'high'
}

export interface ScheduledTask {
  id: string
  prompt: string
  createdAt: string
  runAt?: string
  intervalMinutes?: number
  enabled: boolean
  lastRunAt?: string
  nextRunAt?: string
  lastResult?: string
}

export interface MemoryRecord {
  id: string
  text: string
  tags: string[]
  createdAt: string
  embedding?: number[]
}

export interface RagChunk {
  id: string
  path: string
  content: string
  index: number
  embedding?: number[]
  updatedAt: string
}

export interface SkillDefinition {
  id: string
  name: string
  description: string
  instructions: string
  createdAt: string
}
