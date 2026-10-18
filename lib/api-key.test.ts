import { describe, expect, it } from 'vitest'
import { generateApiKey, generateWebhookSecret, hashKey } from '@/lib/api-key'

describe('hashKey', () => {
  it('returns same hex digest for the same secret', async () => {
    const a = await hashKey('test-secret-1')
    const b = await hashKey('test-secret-1')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for different secrets', async () => {
    const a = await hashKey('a')
    const b = await hashKey('b')
    expect(a).not.toBe(b)
  })
})

describe('generateApiKey', () => {
  it('returns scp_ prefix and 64 hex chars after prefix', () => {
    const k = generateApiKey()
    expect(k.startsWith('scp_')).toBe(true)
    expect(k.length).toBe(4 + 64)
    expect(k.slice(4)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns unique values', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a).not.toBe(b)
  })
})

describe('generateWebhookSecret', () => {
  it('returns whsec_ prefix and hex payload', () => {
    const s = generateWebhookSecret()
    expect(s.startsWith('whsec_')).toBe(true)
    expect(s.length).toBe(6 + 64)
  })
})
