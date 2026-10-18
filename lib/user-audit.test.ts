import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { tryInsertUserAudit } from '@/lib/user-audit'

function mockDb(insertResult: { error: { message: string } | null }) {
  const insert = vi.fn().mockResolvedValue(insertResult)
  const from = vi.fn(() => ({ insert }))
  const db = { from } as unknown as SupabaseClient
  return { db, from, insert }
}

const row = {
  app_id: '550e8400-e29b-41d4-a716-446655440000',
  action: 'test',
  entity_type: 'article',
  entity_id: '660e8400-e29b-41d4-a716-446655440000',
  performed_by: null,
  payload: { ok: true },
} as const

describe('tryInsertUserAudit', () => {
  it('returns undefined when insert succeeds', async () => {
    const { db, from, insert } = mockDb({ error: null })
    const warn = await tryInsertUserAudit(db, row)
    expect(warn).toBeUndefined()
    expect(from).toHaveBeenCalledWith('scp_user_audit_log')
    expect(insert).toHaveBeenCalledWith(row)
  })

  it('returns error message when insert fails', async () => {
    const { db } = mockDb({ error: { message: 'rls violation' } })
    const warn = await tryInsertUserAudit(db, row)
    expect(warn).toBe('rls violation')
  })
})
