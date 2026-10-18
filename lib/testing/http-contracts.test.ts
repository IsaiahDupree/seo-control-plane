import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { expectJson, expectJsonError } from './http-contracts'

function jsonResponse(body: unknown, status: number, contentType = 'application/json') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  })
}

describe('http-contracts', () => {
  describe('expectJsonError', () => {
    it('accepts a JSON error envelope with status and optional code', async () => {
      const res = jsonResponse(
        { error: { code: 'not_found', message: 'missing' } },
        404
      )
      await expectJsonError(res, { status: 404, code: 'not_found' })
    })

    it('accepts when code is omitted', async () => {
      const res = jsonResponse(
        { error: { code: 'x', message: 'y' } },
        500
      )
      await expectJsonError(res, { status: 500 })
    })
  })

  describe('expectJson', () => {
    it('parses body with the given schema', async () => {
      const res = jsonResponse({ ok: true, n: 3 }, 200)
      const data = await expectJson(
        res,
        z.object({ ok: z.boolean(), n: z.number() }),
        { status: 200 }
      )
      expect(data).toEqual({ ok: true, n: 3 })
    })
  })
})
