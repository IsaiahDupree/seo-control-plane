import { describe, expect, it } from 'vitest'
import { signPayload, verifySignature } from './hmac'

describe('hmac', () => {
  it('signPayload returns sha256= hex prefix', async () => {
    const sig = await signPayload('hello', 'secret')
    expect(sig.startsWith('sha256=')).toBe(true)
    expect(sig.length).toBeGreaterThan('sha256='.length)
  })

  it('same payload and secret yield stable signature', async () => {
    const a = await signPayload('body', 'key')
    const b = await signPayload('body', 'key')
    expect(a).toBe(b)
  })

  it('different secrets yield different signatures', async () => {
    const a = await signPayload('body', 'k1')
    const b = await signPayload('body', 'k2')
    expect(a).not.toBe(b)
  })

  it('verifySignature accepts matching signature', async () => {
    const payload = '{"x":1}'
    const secret = 'webhook-secret'
    const sig = await signPayload(payload, secret)
    await expect(verifySignature(payload, sig, secret)).resolves.toBe(true)
  })

  it('verifySignature rejects wrong secret', async () => {
    const payload = 'a'
    const sig = await signPayload(payload, 'good')
    await expect(verifySignature(payload, sig, 'bad')).resolves.toBe(false)
  })

  it('verifySignature rejects tampered payload', async () => {
    const secret = 's'
    const sig = await signPayload('original', secret)
    await expect(verifySignature('tampered', sig, secret)).resolves.toBe(false)
  })

  it('verifySignature rejects length mismatch without throwing', async () => {
    await expect(verifySignature('x', 'short', 'secret')).resolves.toBe(false)
  })
})
