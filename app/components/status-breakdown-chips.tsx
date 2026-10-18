import { ArticleStatusBadge } from '@/app/components/article-status-badge'
import { KeywordStatusBadge } from '@/app/components/keyword-status-badge'

export type StatusCountChip = { status: string; count: number }

type Props = {
  title: string
  items: StatusCountChip[]
  variant: 'article' | 'keyword'
}

/** Labeled row of status badges + counts (dashboard pipeline sections). */
export function StatusBreakdownChips({ title, items, variant }: Props) {
  if (items.length === 0) return null
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
        {title}
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map(({ status, count }) => (
          <div
            key={status}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5"
          >
            {variant === 'article' ? (
              <ArticleStatusBadge status={status} />
            ) : (
              <KeywordStatusBadge status={status} />
            )}
            <span className="tabular-nums text-sm font-medium text-zinc-300">
              {count}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
