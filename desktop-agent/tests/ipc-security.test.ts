import test from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedIpcSource } from '../src/main/ipc-security'

const expected = { webContentsId: 7, processId: 11, routingId: 13 }

test('IPC source contract accepts only the expected WebContents main frame', () => {
  assert.equal(isTrustedIpcSource(expected, expected), true)
  assert.equal(isTrustedIpcSource({ ...expected, webContentsId: 8 }, expected), false)
  assert.equal(isTrustedIpcSource({ ...expected, processId: 12 }, expected), false)
  assert.equal(isTrustedIpcSource({ ...expected, routingId: 14 }, expected), false)
})
