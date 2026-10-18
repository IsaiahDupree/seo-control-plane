import { describe, expect, it } from 'vitest'
import { jsonError } from '@/lib/api-errors'

describe('jsonError', () => {
  it('returns JSON body with status and merged extras', async () => {
    const res = jsonError(400, 'bad_request', 'Invalid input', { field: 'slug' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      error: { code: string; message: string; field?: string }
    }
    expect(body.error.code).toBe('bad_request')
    expect(body.error.message).toBe('Invalid input')
    expect(body.error.field).toBe('slug')
  })
})
