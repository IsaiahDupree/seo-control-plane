import { expect } from 'vitest'
import { z } from 'zod'

const JsonErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
})

export async function expectJsonError(
  res: Response,
  opts: { status: number; code?: string }
) {
  expect(res.status).toBe(opts.status)
  const contentType = res.headers.get('content-type')
  if (contentType) {
    expect(contentType).toContain('application/json')
  }

  const parsed = JsonErrorSchema.safeParse(await res.json())
  expect(parsed.success).toBe(true)
  if (!parsed.success) return

  if (opts.code) {
    expect(parsed.data.error.code).toBe(opts.code)
  }
}

export async function expectJson<TSchema extends z.ZodTypeAny>(
  res: Response,
  schema: TSchema,
  opts?: { status?: number }
): Promise<z.infer<TSchema>> {
  if (opts?.status != null) {
    expect(res.status).toBe(opts.status)
  }

  const contentType = res.headers.get('content-type')
  if (contentType) {
    expect(contentType).toContain('application/json')
  }

  return schema.parse(await res.json()) as z.infer<TSchema>
}

