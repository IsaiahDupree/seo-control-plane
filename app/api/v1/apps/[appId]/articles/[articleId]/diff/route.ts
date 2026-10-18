// F-CP-068: Article version diff endpoint
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const diffQuery = z.object({
  from_version: z.coerce.number().int().min(1).optional(),
  to_version: z.coerce.number().int().min(1).optional(),
})

function computeLineDiff(
  fromText: string,
  toText: string
): Array<{ type: 'added' | 'removed' | 'unchanged'; line: string }> {
  const fromLines = fromText.split('\n')
  const toLines = toText.split('\n')

  const fromSet = new Set(fromLines)
  const toSet = new Set(toLines)

  const result: Array<{ type: 'added' | 'removed' | 'unchanged'; line: string }> = []

  for (const line of fromLines) {
    if (!toSet.has(line)) {
      result.push({ type: 'removed', line })
    } else {
      result.push({ type: 'unchanged', line })
    }
  }
  for (const line of toLines) {
    if (!fromSet.has(line)) {
      result.push({ type: 'added', line })
    }
  }

  return result
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const qp = Object.fromEntries(request.nextUrl.searchParams)
  const queryParsed = diffQuery.safeParse(qp)
  if (!queryParsed.success) {
    return jsonError(400, 'invalid_query', queryParsed.error.message)
  }

  const admin = createAdminClient()

  // Fetch version history for the article from audit log
  const { data: versions, error: verErr } = await admin
    .from('scp_article_versions')
    .select('id, version, body_mdx, title, meta_json, created_at, created_by')
    .eq('article_id', articleId)
    .eq('app_id', appId)
    .order('version', { ascending: false })
    .limit(50)

  if (verErr) return jsonError(500, 'query_failed', verErr.message)
  if (!versions || versions.length === 0) {
    return jsonError(404, 'no_versions', 'No version history found for this article')
  }

  const { from_version, to_version } = queryParsed.data

  const latest = versions[0]
  const previous = versions[1] ?? null

  const fromVer = from_version
    ? versions.find((v) => v.version === from_version) ?? null
    : previous
  const toVer = to_version
    ? versions.find((v) => v.version === to_version) ?? null
    : latest

  if (!toVer) return jsonError(404, 'version_not_found', 'Target version not found')

  const fromBody = (fromVer?.body_mdx as string) ?? ''
  const toBody = (toVer.body_mdx as string) ?? ''

  const lineDiff = computeLineDiff(fromBody, toBody)
  const addedLines = lineDiff.filter((d) => d.type === 'added').length
  const removedLines = lineDiff.filter((d) => d.type === 'removed').length
  const unchangedLines = lineDiff.filter((d) => d.type === 'unchanged').length

  const titleChanged = fromVer?.title !== toVer.title
  const metaChanged = JSON.stringify(fromVer?.meta_json) !== JSON.stringify(toVer.meta_json)

  return NextResponse.json({
    article_id: articleId,
    from: fromVer
      ? { version: fromVer.version, created_at: fromVer.created_at }
      : null,
    to: { version: toVer.version, created_at: toVer.created_at },
    summary: {
      lines_added: addedLines,
      lines_removed: removedLines,
      lines_unchanged: unchangedLines,
      title_changed: titleChanged,
      meta_changed: metaChanged,
    },
    diff: lineDiff.slice(0, 500),
    all_versions: versions.map((v) => ({
      version: v.version,
      created_at: v.created_at,
      created_by: v.created_by,
    })),
  })
}
