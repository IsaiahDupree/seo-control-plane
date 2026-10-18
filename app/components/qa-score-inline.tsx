/** QA score coloring used in article tables (dashboard + app detail). */
export function QaScoreInline({
  score,
  className = '',
}: {
  score: number | null
  className?: string
}) {
  if (score == null) {
    return (
      <span className={`text-zinc-600 ${className}`.trim()}>—</span>
    )
  }
  const color =
    score >= 75 ? 'text-emerald-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400'
  return (
    <span className={`tabular-nums font-medium ${color} ${className}`.trim()}>
      {score}
    </span>
  )
}
