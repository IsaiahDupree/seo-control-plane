// F-CP-033: Sitemap XML generation from published articles
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

function buildSitemapXML(baseUrl: string, urls: Array<{ loc: string; lastmod?: string; changefreq?: string; priority?: string }>): string {
  const entries = urls.map((u) => {
    const parts = [`  <url>`, `    <loc>${u.loc}</loc>`]
    if (u.lastmod) parts.push(`    <lastmod>${u.lastmod}</lastmod>`)
    if (u.changefreq) parts.push(`    <changefreq>${u.changefreq}</changefreq>`)
    if (u.priority) parts.push(`    <priority>${u.priority}</priority>`)
    parts.push(`  </url>`)
    return parts.join('\n')
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const format = searchParams.get('format') ?? 'xml'

  if (!['xml', 'json'].includes(format)) {
    return jsonError(400, 'invalid_format', 'format must be xml or json')
  }

  const admin = createAdminClient()

  const [appResult, articlesResult] = await Promise.all([
    admin.from('scp_apps').select('base_url, domain').eq('id', appId).maybeSingle(),
    admin
      .from('scp_articles')
      .select('slug, updated_at, published_at, focus_keyword')
      .eq('app_id', appId)
      .in('status', ['published', 'indexed', 'ranked'])
      .order('published_at', { ascending: false })
      .limit(50000),
  ])

  if (appResult.error || !appResult.data) return jsonError(404, 'not_found', 'App not found')

  const baseUrl = (appResult.data.base_url ?? `https://${appResult.data.domain ?? 'example.com'}`).replace(/\/$/, '')

  const articles = articlesResult.data ?? []

  const urlEntries = articles.map((a) => ({
    loc: `${baseUrl}/blog/${a.slug}`,
    lastmod: (a.updated_at ?? a.published_at ?? '').slice(0, 10),
    changefreq: 'weekly',
    priority: '0.7',
  }))

  if (format === 'xml') {
    const xml = buildSitemapXML(baseUrl, urlEntries)
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `inline; filename="sitemap.xml"`,
      },
    })
  }

  return NextResponse.json({
    base_url: baseUrl,
    url_count: urlEntries.length,
    urls: urlEntries,
  })
}
