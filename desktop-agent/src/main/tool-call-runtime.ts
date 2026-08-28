import { decisionToolCalls } from './decision-contract'
import type { AgentDecision } from './types'

export interface ToolCallExecution {
  tool: string
  result: unknown
  ok: boolean
}

type ToolDecision = Exclude<AgentDecision, { type: 'final' }>
type ToolRunner = (tool: string, args: Record<string, unknown>) => Promise<unknown>

function resultWasDenied(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'denied' in result
}

export async function executeDecisionToolCalls(
  decision: ToolDecision,
  runTool: ToolRunner
): Promise<ToolCallExecution[]> {
  const executions: ToolCallExecution[] = []

  for (const call of decisionToolCalls(decision)) {
    try {
      const result = await runTool(call.tool, call.args || {})
      const ok = !resultWasDenied(result)
      executions.push({ tool: call.tool, result, ok })
      if (!ok) break
    } catch (error) {
      executions.push({
        tool: call.tool,
        result: { error: error instanceof Error ? error.message : String(error) },
        ok: false
      })
      break
    }
  }

  return executions
}
