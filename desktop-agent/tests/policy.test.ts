import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { clampAgentSteps, isHttpUrl, isPathInside } from '../src/main/policy'

test('HTTP URL policy accepts only http(s)', () => {
  assert.equal(isHttpUrl('https://example.com'), true)
  assert.equal(isHttpUrl('http://localhost:3000'), true)
  assert.equal(isHttpUrl('file:///C:/secret.txt'), false)
  assert.equal(isHttpUrl('javascript:alert(1)'), false)
})

test('workspace policy blocks traversal', () => {
  const root = path.resolve('C:/Users/test/AIRA Workspace')
  assert.equal(isPathInside(root, path.join(root, 'project/file.txt')), true)
  assert.equal(isPathInside(root, path.resolve(root, '../outside.txt')), false)
})

test('agent step policy clamps unsafe values', () => {
  assert.equal(clampAgentSteps(1), 4)
  assert.equal(clampAgentSteps(12), 12)
  assert.equal(clampAgentSteps(999), 30)
})
