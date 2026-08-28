import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAgentDecision } from '../src/main/decision-contract'
import { executeDecisionToolCalls } from '../src/main/tool-call-runtime'

test('multi-call execution is sequential and preserves order', async () => {
  const decision = parseAgentDecision(
    '{"type":"tool_calls","calls":[{"tool":"first","args":{"n":1}},{"tool":"second","args":{"n":2}}]}'
  )
  assert.notEqual(decision.type, 'final')
  if (decision.type === 'final') return

  const observed: string[] = []
  const executions = await executeDecisionToolCalls(decision, async (tool, args) => {
    observed.push(`${tool}:${String(args.n)}`)
    return { ok: true, tool }
  })

  assert.deepEqual(observed, ['first:1', 'second:2'])
  assert.deepEqual(executions.map(({ tool, ok }) => ({ tool, ok })), [
    { tool: 'first', ok: true },
    { tool: 'second', ok: true }
  ])
})

test('multi-call execution stops on a denied tool result', async () => {
  const decision = parseAgentDecision(
    '{"type":"tool_calls","calls":[{"tool":"first","args":{}},{"tool":"blocked","args":{}},{"tool":"never","args":{}}]}'
  )
  if (decision.type === 'final') return

  const observed: string[] = []
  const executions = await executeDecisionToolCalls(decision, async (tool) => {
    observed.push(tool)
    if (tool === 'blocked') return { denied: true }
    return { ok: true }
  })

  assert.deepEqual(observed, ['first', 'blocked'])
  assert.equal(executions.length, 2)
  assert.equal(executions[1]?.ok, false)
})

test('multi-call execution stops on an exception and records the error', async () => {
  const decision = parseAgentDecision(
    '{"type":"tool_calls","calls":[{"tool":"first","args":{}},{"tool":"boom","args":{}},{"tool":"never","args":{}}]}'
  )
  if (decision.type === 'final') return

  const observed: string[] = []
  const executions = await executeDecisionToolCalls(decision, async (tool) => {
    observed.push(tool)
    if (tool === 'boom') throw new Error('failure')
    return { ok: true }
  })

  assert.deepEqual(observed, ['first', 'boom'])
  assert.equal(executions.length, 2)
  assert.deepEqual(executions[1], {
    tool: 'boom',
    result: { error: 'failure' },
    ok: false
  })
})

test('single-tool decisions use the same batch runtime', async () => {
  const decision = parseAgentDecision('{"type":"tool","tool":"one","args":{"x":1}}')
  if (decision.type === 'final') return

  const executions = await executeDecisionToolCalls(decision, async (tool, args) => ({ tool, args }))
  assert.equal(executions.length, 1)
  assert.equal(executions[0]?.tool, 'one')
  assert.equal(executions[0]?.ok, true)
})
