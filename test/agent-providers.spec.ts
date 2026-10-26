import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const { geminiToolName } = await import('../src/main/agent/gemini')
const { cleanError, needsSignIn } = await import('../src/main/agent/process')
const { codexError } = await import('../src/main/agent/codex')

describe('gemini adapter', () => {
  it('strips the MCP server prefix from tool names', () => {
    expect(geminiToolName('mcp_suikopen_create_node')).toBe('create_node')
    expect(geminiToolName('suikopen__get_tree')).toBe('get_tree')
    expect(geminiToolName('google_web_search')).toBe('google_web_search')
  })

  it('unwraps nested API error messages', () => {
    const raw = '[API Error: {"error":{"message":"{\\n  \\"error\\": {\\n    \\"code\\": 400,\\n    \\"message\\": \\"API key not valid. Please pass a valid API key.\\",\\n    \\"status\\": \\"INVALID_ARGUMENT\\"}}"}}]'
    expect(cleanError(raw)).toBe('API key not valid. Please pass a valid API key.')
    expect(cleanError('Quota exceeded')).toBe('Quota exceeded')
  })
})

describe('codex adapter', () => {
  it('explains plan-restricted models', () => {
    const raw = '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-5.6-sol\' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}'
    expect(codexError(raw)).toBe("The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account. Pick another model.")
  })

  it('flags auth failures for sign-in', () => {
    expect(needsSignIn('401 Unauthorized: token expired')).toBe(true)
    expect(needsSignIn('Your refresh token was already used. Please log in again.')).toBe(true)
    expect(needsSignIn('Pick another model.')).toBe(false)
  })
})
