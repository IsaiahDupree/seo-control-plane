import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cronBearerOk, getCronSecret } from '@/lib/cron-auth'

describe('getCronSecret', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns undefined when neither env is set', () => {
    vi.stubEnv('SCP_CRON_SECRET', '')
    vi.stubEnv('CRON_SECRET', '')
    expect(getCronSecret()).toBeUndefined()
  })

  it('prefers SCP_CRON_SECRET over CRON_SECRET', () => {
    vi.stubEnv('SCP_CRON_SECRET', 'primary')
    vi.stubEnv('CRON_SECRET', 'fallback')
    expect(getCronSecret()).toBe('primary')
  })

  it('falls back to CRON_SECRET when SCP_CRON_SECRET is empty after trim', () => {
    vi.stubEnv('SCP_CRON_SECRET', '   ')
    vi.stubEnv('CRON_SECRET', 'fallback-secret')
    expect(getCronSecret()).toBe('fallback-secret')
  })

  it('trims whitespace', () => {
    vi.stubEnv('SCP_CRON_SECRET', '  spaced  ')
    expect(getCronSecret()).toBe('spaced')
  })
})

describe('cronBearerOk', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows any request when no secret is configured', () => {
    vi.stubEnv('SCP_CRON_SECRET', '')
    vi.stubEnv('CRON_SECRET', '')
    const req = new NextRequest('http://localhost/', {
      headers: {},
    })
    expect(cronBearerOk(req)).toBe(true)
  })

  it('requires Bearer token when secret is set', () => {
    vi.stubEnv('SCP_CRON_SECRET', 'cron-key')
    const bad = new NextRequest('http://localhost/', {
      headers: { Authorization: 'Bearer wrong' },
    })
    expect(cronBearerOk(bad)).toBe(false)
    const good = new NextRequest('http://localhost/', {
      headers: { Authorization: 'Bearer cron-key' },
    })
    expect(cronBearerOk(good)).toBe(true)
  })
})
