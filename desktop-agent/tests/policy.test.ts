import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertPublicBrowserNetworkUrl,
  clampAgentSteps,
  isBrowserNetworkUrl,
  isHttpUrl,
  isPathInside,
  isPublicNetworkAddress,
  resolvePathInsideRoot,
  sanitizeAuditSummary
} from '../src/main/policy'

test('HTTP URL policy accepts credential-free http(s) only', () => {
  assert.equal(isHttpUrl('https://example.com'), true)
  assert.equal(isHttpUrl('http://localhost:3000'), true)
  assert.equal(isHttpUrl('https://user:pass@example.com'), false)
  assert.equal(isHttpUrl('file:///C:/secret.txt'), false)
  assert.equal(isHttpUrl('javascript:alert(1)'), false)
})

test('browser network URL policy includes credential-free WebSockets only', () => {
  assert.equal(isBrowserNetworkUrl('wss://example.com/socket'), true)
  assert.equal(isBrowserNetworkUrl('ws://127.0.0.1:3000/socket'), true)
  assert.equal(isBrowserNetworkUrl('wss://user:pass@example.com/socket'), false)
  assert.equal(isBrowserNetworkUrl('file:///C:/secret.txt'), false)
})

test('browser network policy rejects private loopback link-local metadata mapped and reserved addresses', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '::1',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1'
  ]) assert.equal(isPublicNetworkAddress(address), false, address)
  assert.equal(isPublicNetworkAddress('1.1.1.1'), true)
  assert.equal(isPublicNetworkAddress('2606:4700:4700::1111'), true)
})

test('browser network policy rejects private WebSocket destinations before connection', async () => {
  await assert.rejects(() => assertPublicBrowserNetworkUrl('ws://127.0.0.1:3000/socket'), /blocked/i)
  await assert.rejects(() => assertPublicBrowserNetworkUrl('wss://[::ffff:7f00:1]/socket'), /blocked/i)
  await assert.rejects(() => assertPublicBrowserNetworkUrl('wss://user:pass@example.com/socket'), /credential-free/i)
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

test('workspace policy blocks symlink and junction escape through an existing ancestor', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'aira-policy-'))
  const root = path.join(temp, 'workspace')
  const outside = path.join(temp, 'outside')
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  const link = path.join(root, 'escape')
  try {
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => resolvePathInsideRoot(root, path.join(link, 'secret.txt')), /symlink|junction|escapes/i)
    assert.equal(resolvePathInsideRoot(root, path.join(root, 'safe', 'file.txt')), path.resolve(root, 'safe', 'file.txt'))
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('agent step policy clamps unsafe values', () => {
  assert.equal(clampAgentSteps(1), 4)
  assert.equal(clampAgentSteps(12), 12)
  assert.equal(clampAgentSteps(999), 30)
})
