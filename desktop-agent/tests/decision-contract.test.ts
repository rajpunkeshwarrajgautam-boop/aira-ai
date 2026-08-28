import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_TOOL_CALLS_PER_DECISION,
  decisionToolCalls,
  parseAgentDecision
} from '../src/main/decision-contract'

test('single-tool decisions remain backward compatible', () => {
  const decision = parseAgentDecision('{"type":"tool","tool":"web_search","args":{"q":"AIRA"},"reasoning":"Search"}')
  assert.equal(decision.type, 'tool')
  if (decision.type !== 'tool') return
  assert.equal(decision.tool, 'web_search')
  assert.deepEqual(decision.args, { q: 'AIRA' })
  assert.deepEqual(decisionToolCalls(decision), [{ tool: 'web_search', args: { q: 'AIRA' } }])
})

test('tool_calls decisions preserve deterministic call order', () => {
  const decision = parseAgentDecision(
    '{"type":"tool_calls","calls":[{"tool":"first","args":{"n":1}},{"tool":"second","args":{"n":2}}]}'
  )
  assert.equal(decision.type, 'tool_calls')
  if (decision.type !== 'tool_calls') return
  assert.deepEqual(decisionToolCalls(decision), [
    { tool: 'first', args: { n: 1 } },
    { tool: 'second', args: { n: 2 } }
  ])
})

test('final decisions remain supported', () => {
  assert.deepEqual(parseAgentDecision('{"type":"final","content":"Done"}'), {
    type: 'final',
    content: 'Done',
    plan: undefined
  })
})

test('tool_calls rejects empty call batches', () => {
  assert.throws(
    () => parseAgentDecision('{"type":"tool_calls","calls":[]}'),
    /non-empty calls array/
  )
})

test('tool_calls rejects malformed args', () => {
  assert.throws(
    () => parseAgentDecision('{"type":"tool_calls","calls":[{"tool":"x","args":[]}] }'),
    /args must be a JSON object/
  )
})

test('tool_calls rejects oversized batches', () => {
  const calls = Array.from({ length: MAX_TOOL_CALLS_PER_DECISION + 1 }, (_, index) => ({
    tool: `tool_${index}`,
    args: {}
  }))
  assert.throws(
    () => parseAgentDecision(JSON.stringify({ type: 'tool_calls', calls })),
    new RegExp(`${MAX_TOOL_CALLS_PER_DECISION}-call safety limit`)
  )
})

test('unsupported decision types fail closed', () => {
  assert.throws(() => parseAgentDecision('{"type":"unknown"}'), /Unsupported agent decision/)
})
