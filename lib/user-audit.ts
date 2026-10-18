import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Row written to `scp_user_audit_log.payload` (JSONB).
 * Use JSON-serializable values only (no `Date`, `undefined`, or class instances).
 */
export type UserAuditRow = {
  app_id: string
  action: string
  entity_type: string
  entity_id: string
  performed_by: null
  payload: Record<string, unknown>
}

/** Insert `scp_user_audit_log` row; returns `audit_warning` text on failure (non-blocking). */
export async function tryInsertUserAudit(
  db: SupabaseClient,
  row: UserAuditRow
): Promise<string | undefined> {
  const { error } = await db.from('scp_user_audit_log').insert(row)
  return error?.message
}
