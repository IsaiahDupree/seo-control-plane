/** Tailwind classes for article pipeline statuses (shared dashboard + app detail). */
export const ARTICLE_STATUS_CLASS_MAP: Record<string, string> = {
  delivered: 'bg-emerald-900/40 text-emerald-400 border-emerald-800',
  approved: 'bg-blue-900/40 text-blue-400 border-blue-800',
  published: 'bg-emerald-900/60 text-emerald-300 border-emerald-700',
  queued: 'bg-cyan-900/35 text-cyan-400 border-cyan-800',
  qa_review: 'bg-yellow-900/40 text-yellow-400 border-yellow-800',
  qa_pending: 'bg-orange-900/40 text-orange-400 border-orange-800',
  generating: 'bg-purple-900/40 text-purple-400 border-purple-800',
  draft: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  brief_pending: 'bg-zinc-800 text-zinc-500 border-zinc-700',
  archived: 'bg-zinc-900 text-zinc-600 border-zinc-800',
  other: 'bg-rose-900/30 text-rose-400 border-rose-900',
}

export function ArticleStatusBadge({ status }: { status: string }) {
  const cls =
    ARTICLE_STATUS_CLASS_MAP[status] ??
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
