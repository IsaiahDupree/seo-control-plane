import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockGetCronSecret = vi.fn()
const mockRunBatch = vi.fn()

vi.mock('@/lib/cron-auth', () => ({
  getCronSecret: () => mockGetCronSecret(),
}))

vi.mock('@/lib/process-pending-briefs', () => ({
  runProcessPendingBriefsBatch: (...args: unknown[]) => mockRunBatch(...args),
}))

import { GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const CRON_SECRET = 'cron-secret-value'

describe('/api/cron/process-pending', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('returns 503 when cron secret is not configured', async () => {
      mockGetCronSecret.mockReturnValue(undefined)
      const req = new NextRequest(
        `http://localhost/api/cron/process-pending?app_id=${APP_ID}`
      )
      const res = await GET(req)
      expect(res.status).toBe(503)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('cron_disabled')
      expect(mockRunBatch).not.toHaveBeenCalled()
    })

    it('returns 401 when Authorization is wrong', async () => {
      mockGetCronSecret.mockReturnValue(CRON_SECRET)
      const req = new NextRequest(
        `http://localhost/api/cron/process-pending?app_id=${APP_ID}`,
        { headers: { Authorization: 'Bearer wrong' } }
      )
      const res = await GET(req)
      expect(res.status).toBe(401)
      expect(mockRunBatch).not.toHaveBeenCalled()
    })

    it('returns 400 when app_id query is missing or invalid', async () => {
      mockGetCronSecret.mockReturnValue(CRON_SECRET)
      const req = new NextRequest('http://localhost/api/cron/process-pending', {
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      })
      const res = await GET(req)
      expect(res.status).toBe(400)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('validation_error')
    })

    it('returns 200 empty payload when batch has no work', async () => {
      mockGetCronSecret.mockReturnValue(CRON_SECRET)
      mockRunBatch.mockResolvedValue({ kind: 'empty' as const })
      const req = new NextRequest(
        `http://localhost/api/cron/process-pending?app_id=${APP_ID}`,
        { headers: { Authorization: `Bearer ${CRON_SECRET}` } }
      )
      const res = await GET(req)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { processed: unknown[]; message: string; source: string }
      expect(body.processed).toEqual([])
      expect(body.source).toBe('cron')
      expect(mockRunBatch).toHaveBeenCalledWith(APP_ID, 1, {})
    })

    it('passes limit from query to batch', async () => {
      mockGetCronSecret.mockReturnValue(CRON_SECRET)
      mockRunBatch.mockResolvedValue({ kind: 'empty' as const })
      const req = new NextRequest(
        `http://localhost/api/cron/process-pending?app_id=${APP_ID}&limit=2`,
        { headers: { Authorization: `Bearer ${CRON_SECRET}` } }
      )
      await GET(req)
      expect(mockRunBatch).toHaveBeenCalledWith(APP_ID, 2, {})
    })

    it('returns 500 when batch reports query_failed', async () => {
      mockGetCronSecret.mockReturnValue(CRON_SECRET)
      mockRunBatch.mockResolvedValue({
        kind: 'query_failed' as const,
        message: 'connection reset',
      })
      const req = new NextRequest(
        `http://localhost/api/cron/process-pending?app_id=${APP_ID}`,
        { headers: { Authorization: `Bearer ${CRON_SECRET}` } }
      )
      const res = await GET(req)
      expect(res.status).toBe(500)
      const j = (await res.json()) as { error: { code: string; message: string } }
      expect(j.error.code).toBe('query_failed')
      expect(j.error.message).toBe('connection reset')
    })

    it('returns 404 when batch reports app_not_found', async () => {
      mockGetCronSecret.mockReturnValue(CRON_SECRET)
      mockRunBatch.mockResolvedValue({ kind: 'app_not_found' as const })
      const req = new NextRequest(
        `http://localhost/api/cron/process-pending?app_id=${APP_ID}`,
        { headers: { Authorization: `Bearer ${CRON_SECRET}` } }
      )
      const res = await GET(req)
      expect(res.status).toBe(404)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('app_not_found')
    })

    it('returns 200 with processed and failures on success', async () => {
      mockGetCronSecret.mockReturnValue(CRON_SECRET)
      mockRunBatch.mockResolvedValue({
        kind: 'success' as const,
        processed: [
          {
            brief_id: '770e8400-e29b-41d4-a716-446655440000',
            article_id: '880e8400-e29b-41d4-a716-446655440000',
            slug: 'a',
            title: 'A',
          },
        ],
        failures: [
          {
            brief_id: '990e8400-e29b-41d4-a716-446655440000',
            code: 'brief_not_pending',
            message: 'Already generating',
          },
        ],
      })
      const req = new NextRequest(
        `http://localhost/api/cron/process-pending?app_id=${APP_ID}`,
        { headers: { Authorization: `Bearer ${CRON_SECRET}` } }
      )
      const res = await GET(req)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        source: string
        processed: Array<{ slug: string; brief_id: string; article_id: string; title: string }>
        failures: Array<{ brief_id: string; code: string }>
      }
      expect(body.source).toBe('cron')
      expect(body.processed).toHaveLength(1)
      expect(body.processed[0].slug).toBe('a')
      expect(body.failures).toHaveLength(1)
      expect(body.failures[0].code).toBe('brief_not_pending')
    })
  })

  describe('POST', () => {
    it('returns 503 when cron secret is not configured', async () => {
      mockGetCronSecret.mockReturnValue(undefined)
      const req = new NextRequest('http://localhost/api/cron/process-pending', {
        method: 'POST',
        body: JSON.stringify({ app_id: APP_ID }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req)
      expect(res.status).toBe(503)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('cron_disabled')
    })

    it('returns 400 for invalid JSON', async () => {
      mockGetCronSecret.mockReturnValue(CRON_SECRET)
      const req = new NextRequest('http://localhost/api/cron/process-pending', {
        method: 'POST',
        body: 'not-json',
        headers: {
          Authorization: `Bearer ${CRON_SECRET}`,
          'Content-Type': 'application/json',
        },
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('invalid_json')
    })

    it('returns 400 when app_id in body is not a valid UUID', async () => {
      mockGetCronSecret.mockReturnValue(CRON_SECRET)
      const req = new NextRequest('http://localhost/api/cron/process-pending', {
        method: 'POST',
        body: JSON.stringify({ app_id: 'not-a-uuid' }),
        headers: {
          Authorization: `Bearer ${CRON_SECRET}`,
          'Content-Type': 'application/json',
        },
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('validation_error')
      expect(mockRunBatch).not.toHaveBeenCalled()
    })

    it('returns 429 when batch hits monthly limit', async () => {
      mockGetCronSecret.mockReturnValue(CRON_SECRET)
      mockRunBatch.mockResolvedValue({
        kind: 'monthly_limit' as const,
        used: 100,
        limit: 100,
        partial: [],
      })
      const req = new NextRequest('http://localhost/api/cron/process-pending', {
        method: 'POST',
        body: JSON.stringify({ app_id: APP_ID }),
        headers: {
          Authorization: `Bearer ${CRON_SECRET}`,
          'Content-Type': 'application/json',
        },
      })
      const res = await POST(req)
      expect(res.status).toBe(429)
      const j = (await res.json()) as { error: { code: string; used?: number } }
      expect(j.error.code).toBe('monthly_limit_exceeded')
      expect(j.error.used).toBe(100)
    })
  })
})
