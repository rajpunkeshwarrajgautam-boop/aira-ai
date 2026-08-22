import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isLoopbackOpenAICompatibleUrl,
  openAICompatibleAuthHeaders,
  openAICompatibleChatUrl,
  openAICompatibleModelsUrl
} from '../src/main/openai-compatible'

test('OpenAI-compatible URLs normalize llama.cpp base paths', () => {
  assert.equal(openAICompatibleChatUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080/v1/chat/completions')
  assert.equal(openAICompatibleChatUrl('http://127.0.0.1:8080/v1/'), 'http://127.0.0.1:8080/v1/chat/completions')
  assert.equal(openAICompatibleModelsUrl('http://localhost:8080'), 'http://localhost:8080/v1/models')
  assert.equal(openAICompatibleChatUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions')
})

test('loopback OpenAI-compatible endpoints may run without an API key', () => {
  assert.equal(isLoopbackOpenAICompatibleUrl('http://127.0.0.1:8080/v1'), true)
  assert.equal(isLoopbackOpenAICompatibleUrl('http://localhost:8080/v1'), true)
  assert.equal(isLoopbackOpenAICompatibleUrl('http://[::1]:8080/v1'), true)
  assert.deepEqual(openAICompatibleAuthHeaders('http://127.0.0.1:8080/v1', null), {})
})

test('remote OpenAI-compatible endpoints still require authentication', () => {
  assert.equal(isLoopbackOpenAICompatibleUrl('https://localhost.example.com/v1'), false)
  assert.throws(
    () => openAICompatibleAuthHeaders('https://api.openai.com/v1', ''),
    /Remote API key is not configured/
  )
  assert.deepEqual(openAICompatibleAuthHeaders('https://api.openai.com/v1', 'secret'), {
    Authorization: 'Bearer secret'
  })
})
