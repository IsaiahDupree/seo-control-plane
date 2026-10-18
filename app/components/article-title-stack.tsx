import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

type Props = {
  title: string
  canonicalUrl: string | null
  /** Optional second line (monospace slug). */
  slug?: string
  /** When set, the title is this link (e.g. `/apps/[appId]` on the home dashboard). */
  titleHref?: string
}

/** Title row for article tables: optional link, optional slug line, optional canonical URL icon. */
export function ArticleTitleStack({
  title,
  slug,
  canonicalUrl,
  titleHref,
}: Props) {
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <div className="min-w-0 flex-1">
        {titleHref ? (
          <Link
            href={titleHref}
            className="block min-w-0 truncate text-zinc-200 hover:text-emerald-400 transition-colors"
            title={title}
          >
            {title}
          </Link>
        ) : (
          <p className="truncate text-zinc-200 text-xs">{title}</p>
        )}
        {slug ? (
          <p className="truncate font-mono text-[10px] text-zinc-600">{slug}</p>
        ) : null}
      </div>
      {canonicalUrl ? (
        <a
          href={canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-zinc-600 hover:text-emerald-400 mt-0.5"
          aria-label="Open canonical URL"
        >
          <ExternalLink className="size-3.5" strokeWidth={2} />
        </a>
      ) : null}
    </div>
  )
}
