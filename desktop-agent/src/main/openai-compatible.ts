export function normalizeOpenAICompatibleBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('OpenAI-compatible base URL is empty.')
  return trimmed
}

export function isLoopbackOpenAICompatibleUrl(value: string): boolean {
  try {
    const url = new URL(normalizeOpenAICompatibleBaseUrl(value))
    const hostname = url.hostname.toLowerCase()
    return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  } catch {
    return false
  }
}

export function openAICompatibleChatUrl(baseUrl: string): string {
  const base = normalizeOpenAICompatibleBaseUrl(baseUrl)
  return /\/v1$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`
}

export function openAICompatibleModelsUrl(baseUrl: string): string {
  const base = normalizeOpenAICompatibleBaseUrl(baseUrl)
  return /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`
}

export function openAICompatibleAuthHeaders(baseUrl: string, apiKey?: string | null): Record<string, string> {
  const key = apiKey?.trim()
  if (key) return { Authorization: `Bearer ${key}` }
  if (isLoopbackOpenAICompatibleUrl(baseUrl)) return {}
  throw new Error('Remote API key is not configured in the encrypted vault. API keys are optional only for loopback OpenAI-compatible endpoints such as local llama.cpp.')
}
