import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSeoControlPlaneClient,
  isSeoControlPlaneHttpError,
  registerSeoControlPlaneApp,
  SeoControlPlaneHttpError,
  verifySCPWebhook,
} from './index'

describe('SeoControlPlaneHttpError', () => {
  it('isSeoControlPlaneHttpError narrows instance', () => {
    const e = new SeoControlPlaneHttpError('msg', 403, 'forbidden', {})
    expect(isSeoControlPlaneHttpError(e)).toBe(true)
    expect(isSeoControlPlaneHttpError(new Error('other'))).toBe(false)
  })
})

describe('registerSeoControlPlaneApp', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('strips trailing slash on baseUrl and parses 200 JSON', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          app: { id: 'u', slug: 's', name: 'n' },
          api_key: 'k',
          message: 'ok',
        }),
        { status: 200 }
      )
    ) as typeof fetch

    const r = await registerSeoControlPlaneApp({
      baseUrl: 'https://cp.example/',
      registerSecret: 'sec',
      slug: 's',
      name: 'n',
    })
    expect(r.api_key).toBe('k')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://cp.example/api/apps/register',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws with code and message on 4xx JSON error', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { code: 'duplicate', message: 'Slug taken' } }),
        { status: 409 }
      )
    ) as typeof fetch

    try {
      await registerSeoControlPlaneApp({
        baseUrl: 'https://cp.example',
        registerSecret: 'sec',
        slug: 's',
        name: 'n',
      })
      expect.fail('expected throw')
    } catch (e) {
      expect(isSeoControlPlaneHttpError(e)).toBe(true)
      if (isSeoControlPlaneHttpError(e)) {
        expect(e.status).toBe(409)
        expect(e.code).toBe('duplicate')
        expect(e.message).toBe('Slug taken')
      }
    }
  })

  it('throws on 200 with invalid JSON', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('not json', { status: 200 })
    ) as typeof fetch

    await expect(
      registerSeoControlPlaneApp({
        baseUrl: 'https://cp.example',
        registerSecret: 'sec',
        slug: 's',
        name: 'n',
      })
    ).rejects.toMatchObject({ name: 'SeoControlPlaneHttpError', status: 200 })
  })
})

describe('createSeoControlPlaneClient', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('getDashboard calls dashboard/gaps with Bearer api key', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ gaps: [] }), { status: 200 })
    ) as typeof fetch

    const client = createSeoControlPlaneClient({
      baseUrl: 'https://cp.example/',
      appId: 'app-1',
      apiKey: 'sk_test',
    })
    await client.getDashboard()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://cp.example/api/v1/apps/app-1/dashboard/gaps',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test',
        }),
      })
    )
  })
})

describe('verifySCPWebhook', () => {
  it('returns true for matching HMAC', async () => {
    const secret = 'a'.repeat(32)
    const rawBody = '{"event":"article.delivered"}'
    const sig =
      'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
    await expect(verifySCPWebhook(rawBody, sig, secret)).resolves.toBe(true)
  })

  it('returns false for wrong signature', async () => {
    const secret = 'a'.repeat(32)
    const rawBody = '{}'
    await expect(
      verifySCPWebhook(rawBody, 'sha256=' + '0'.repeat(64), secret)
    ).resolves.toBe(false)
  })
})
