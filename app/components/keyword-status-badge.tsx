/** Tailwind classes for `scp_keywords.status` (see `keywordStatusSchema`). */
export const KEYWORD_STATUS_CLASS_MAP: Record<string, string> = {
  unassigned: 'bg-zinc-800 text-zinc-500 border-zinc-700',
  brief_created: 'bg-purple-900/40 text-purple-400 border-purple-800',
  assigned: 'bg-blue-900/40 text-blue-400 border-blue-800',
  published: 'bg-emerald-900/40 text-emerald-400 border-emerald-800',
  other: 'bg-rose-900/30 text-rose-400 border-rose-900',
}

export function KeywordStatusBadge({ status }: { status: string }) {
  const cls =
    KEYWORD_STATUS_CLASS_MAP[status] ??
    'bg-zinc-800 text-zinc-400 border-zinc-700'
  const label =
    status === 'other' ? 'other (unknown status)' : status.replace(/_/g, ' ')
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  )
}
