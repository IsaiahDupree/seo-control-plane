import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hostFromUrl,
  parseIndexNowFromMetadata,
  resolveCanonicalArticleUrl,
  resolveIndexNowHost,
  submitUrlsToIndexNow,
} from '@/lib/indexnow'

describe('hostFromUrl', () => {
  it('returns hostname for valid URLs', () => {
    expect(hostFromUrl('https://www.example.com/path?q=1')).toBe('www.example.com')
  })

  it('returns null for invalid input', () => {
    expect(hostFromUrl('not a url')).toBeNull()
  })
})

describe('parseIndexNowFromMetadata', () => {
  it('returns empty config for null and non-objects', () => {
    expect(parseIndexNowFromMetadata(null)).toEqual({
      key: undefined,
      keyLocation: undefined,
      hostOverride: undefined,
      onPublish: false,
    })
    expect(parseIndexNowFromMetadata([])).toEqual(
      expect.objectContaining({ onPublish: false })
    )
  })

  it('reads indexnow_* fields', () => {
    const cfg = parseIndexNowFromMetadata({
      indexnow_key: 'k'.repeat(8),
      indexnow_key_location: 'https://example.com/key.txt',
      indexnow_host: 'example.com',
      indexnow_on_publish: true,
    })
    expect(cfg.key).toBe('k'.repeat(8))
    expect(cfg.keyLocation).toBe('https://example.com/key.txt')
    expect(cfg.hostOverride).toBe('example.com')
    expect(cfg.onPublish).toBe(true)
  })
})

describe('resolveIndexNowHost', () => {
  it('prefers trimmed host override', () => {
    expect(resolveIndexNowHost('https://ignore.com/', '  my.site  ')).toBe('my.site')
  })

  it('falls back to hostname from URL', () => {
    expect(resolveIndexNowHost('https://blog.example.com/x', undefined)).toBe('blog.example.com')
  })
})

describe('resolveCanonicalArticleUrl', () => {
  it('prefers published_url', () => {
    expect(
      resolveCanonicalArticleUrl({
        publishedUrl: 'https://x.com/p',
        baseUrl: 'https://x.com',
        slug: 's',
      })
    ).toBe('https://x.com/p')
  })

  it('builds /blog/{slug} from base', () => {
    expect(
      resolveCanonicalArticleUrl({
        publishedUrl: null,
        baseUrl: 'https://x.com/',
        slug: 'hello',
      })
    ).toBe('https://x.com/blog/hello')
  })

  it('returns null without base or published URL', () => {
    expect(resolveCanonicalArticleUrl({ slug: 'x' })).toBeNull()
  })
})

describe('submitUrlsToIndexNow', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns ok true for HTTP 200 and 202', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 202 })) as typeof fetch

    const base = {
      host: 'example.com',
      key: '12345678',
      urlList: ['https://example.com/a'],
    }
    expect((await submitUrlsToIndexNow(base)).ok).toBe(true)
    expect((await submitUrlsToIndexNow(base)).ok).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalled()
  })

  it('returns ok false for other status codes', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 400 })) as typeof fetch
    const r = await submitUrlsToIndexNow({
      host: 'example.com',
      key: '12345678',
      urlList: ['https://example.com/a'],
    })
    expect(r.ok).toBe(false)
    expect(r.httpStatus).toBe(400)
    expect(r.responseText).toBe('nope')
  })

  it('includes keyLocation in JSON body when set', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 200 })) as typeof fetch
    await submitUrlsToIndexNow({
      host: 'example.com',
      key: '12345678',
      keyLocation: 'https://example.com/key.txt',
      urlList: ['https://example.com/a'],
    })
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string) as {
      keyLocation?: string
    }
    expect(body.keyLocation).toBe('https://example.com/key.txt')
  })

  it('propagates when fetch rejects', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('network down')) as typeof fetch
    await expect(
      submitUrlsToIndexNow({
        host: 'example.com',
        key: '12345678',
        urlList: ['https://example.com/a'],
      })
    ).rejects.toThrow('network down')
  })
})
