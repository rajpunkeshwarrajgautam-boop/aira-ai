import type { AgentDecision, AgentToolCall } from './types'

export const MAX_TOOL_CALLS_PER_DECISION = 16

export const AGENT_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['final', 'tool', 'tool_calls'] },
    content: { type: 'string' },
    tool: { type: 'string' },
    args: { type: 'object' },
    calls: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_TOOL_CALLS_PER_DECISION,
      items: {
        type: 'object',
        properties: {
          tool: { type: 'string' },
          args: { type: 'object' }
        },
        required: ['tool']
      }
    },
    reasoning: { type: 'string' },
    plan: { type: 'array', items: { type: 'string' } }
  },
  required: ['type']
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalPlan(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('Agent decision plan must be an array of strings.')
  }
  return value.slice(0, 12)
}

function optionalReasoning(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error('Agent decision reasoning must be a string.')
  return value
}

function optionalArgs(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('Agent tool args must be a JSON object.')
  return value
}

function parseToolCall(value: unknown): AgentToolCall {
  if (!isRecord(value)) throw new Error('Each tool_calls entry must be a JSON object.')
  if (typeof value.tool !== 'string' || !value.tool.trim()) {
    throw new Error('Each tool_calls entry requires a non-empty tool name.')
  }
  return {
    tool: value.tool.trim(),
    args: optionalArgs(value.args)
  }
}

export function parseAgentDecision(text: string): AgentDecision {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const json = start >= 0 && end > start ? text.slice(start, end + 1) : text
  const parsed: unknown = JSON.parse(json)
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    throw new Error('Agent decision must be a JSON object with a type.')
  }

  const plan = optionalPlan(parsed.plan)
  const reasoning = optionalReasoning(parsed.reasoning)

  if (parsed.type === 'final') {
    if (parsed.content !== undefined && typeof parsed.content !== 'string') {
      throw new Error('Final decision content must be a string.')
    }
    return { type: 'final', content: typeof parsed.content === 'string' ? parsed.content : '', plan }
  }

  if (parsed.type === 'tool') {
    if (typeof parsed.tool !== 'string' || !parsed.tool.trim()) {
      throw new Error('Single-tool decision requires a non-empty tool name.')
    }
    return {
      type: 'tool',
      tool: parsed.tool.trim(),
      args: optionalArgs(parsed.args),
      reasoning,
      plan
    }
  }

  if (parsed.type === 'tool_calls') {
    if (!Array.isArray(parsed.calls) || parsed.calls.length === 0) {
      throw new Error('tool_calls decision requires a non-empty calls array.')
    }
    if (parsed.calls.length > MAX_TOOL_CALLS_PER_DECISION) {
      throw new Error(`tool_calls decision exceeds the ${MAX_TOOL_CALLS_PER_DECISION}-call safety limit.`)
    }
    return {
      type: 'tool_calls',
      calls: parsed.calls.map(parseToolCall),
      reasoning,
      plan
    }
  }

  throw new Error('Unsupported agent decision.')
}

export function decisionToolCalls(decision: Exclude<AgentDecision, { type: 'final' }>): AgentToolCall[] {
  if (decision.type === 'tool') {
    return [{ tool: decision.tool, args: decision.args }]
  }
  return decision.calls
}
