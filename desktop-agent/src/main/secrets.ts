import { safeStorage } from 'electron'
import Store from 'electron-store'

interface SecretSchema {
  values: Record<string, string>
}

const secretStore = new Store<SecretSchema>({ name: 'vault', defaults: { values: {} } })
const allowedKeys = new Set(['remoteApiKey', 'airaSyncToken'])

function assertKey(key: string): void {
  if (!allowedKeys.has(key)) throw new Error('Unsupported secret key.')
}

export function setSecret(key: string, value: string): boolean {
  assertKey(key)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.')
  const values = secretStore.get('values', {})
  if (!value) {
    delete values[key]
  } else {
    values[key] = safeStorage.encryptString(value).toString('base64')
  }
  secretStore.set('values', values)
  return true
}

export function getSecret(key: string): string {
  assertKey(key)
  const encoded = secretStore.get('values', {})[key]
  if (!encoded || !safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch {
    return ''
  }
}

export function secretStatus(): Record<string, boolean> {
  const values = secretStore.get('values', {})
  return Object.fromEntries([...allowedKeys].map((key) => [key, Boolean(values[key])]))
}
