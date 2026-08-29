import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { clampAgentSteps, isHttpUrl, isPathInside, isPublicNetworkAddress, sanitizeAuditSummary } from '../src/main/policy'

test('HTTP URL policy accepts credential-free http(s) only', () => {
  assert.equal(isHttpUrl('https://example.com'), true)
  assert.equal(isHttpUrl('http://localhost:3000'), true)
  assert.equal(isHttpUrl('https://user:pass@example.com'), false)
  assert.equal(isHttpUrl('file:///C:/secret.txt'), false)
  assert.equal(isHttpUrl('javascript:alert(1)'), false)
})

test('browser network policy rejects private loopback link-local metadata and mapped addresses', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    '::ffff:127.0.0.1'
  ]) assert.equal(isPublicNetworkAddress(address), false, address)
  assert.equal(isPublicNetworkAddress('1.1.1.1'), true)
  assert.equal(isPublicNetworkAddress('2606:4700:4700::1111'), true)
})

test('audit summary stores shape and lengths instead of sensitive string contents', () => {
  const raw = JSON.stringify({ text: 'super-secret typed value', token: 'abc123', nested: { content: 'private file body' } })
  const safe = sanitizeAuditSummary(raw) || ''
  assert.equal(safe.includes('super-secret typed value'), false)
  assert.equal(safe.includes('abc123'), false)
  assert.equal(safe.includes('private file body'), false)
  assert.match(safe, /\[redacted\]/)
  assert.match(safe, /<string:/)
})

test('plain-text audit summaries redact credential-shaped values', () => {
  const safe = sanitizeAuditSummary('Authorization: Bearer ghp_abcdef123456789 token=secret-value') || ''
  assert.equal(safe.includes('ghp_abcdef123456789'), false)
  assert.equal(safe.includes('secret-value'), false)
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
