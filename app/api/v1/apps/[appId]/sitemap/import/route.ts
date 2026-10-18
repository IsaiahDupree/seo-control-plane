// F-CP-028: Sitemap import for existing content
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

function extractSlug(url: string): string {
  try {
    const parsed = new URL(url)
    // Remove leading slash and base path
    let path = parsed.pathname.replace(/\/$/, '')
    // Strip /blog/ prefix variants
    path = path.replace(/^\/(blog|articles?|posts?|news)\//, '')
    return path.replace(/^\//, '') || url
  } catch {
    // Relative URL
    return url.replace(/^\/(blog|articles?|posts?|news)\//, '').replace(/\/$/, '')
  }
}

async function fetchSitemap(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SEOControlPlane-SitemapBot/1.0' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching sitemap`)
  return res.text()
}

function parseUrlsFromXML(xml: string): string[] {
  const urls: string[] = []
  // Handle sitemap index (nested sitemaps)
  const sitemapLocRegex = /<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = sitemapLocRegex.exec(xml)) !== null) {
    const loc = m[1].trim()
    if (loc) urls.push(loc) // these are sub-sitemaps, caller will recurse
  }
  if (urls.length > 0) return urls // sitemap index — return sub-sitemap URLs

  // Regular sitemap
  const urlLocRegex = /<url>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi
  while ((m = urlLocRegex.exec(xml)) !== null) {
    const loc = m[1].trim()
    if (loc) urls.push(loc)
  }
  return urls
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const sitemapUrl = searchParams.get('url')

  if (!sitemapUrl) {
    return jsonError(400, 'missing_url', 'Provide ?url= pointing to the sitemap XML')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(sitemapUrl)
  } catch {
    return jsonError(400, 'invalid_url', 'Invalid sitemap URL')
  }

  // Fetch sitemap
  let xml: string
  try {
    xml = await fetchSitemap(sitemapUrl)
  } catch (e) {
    return jsonError(502, 'fetch_failed', e instanceof Error ? e.message : 'Could not fetch sitemap')
  }

  let urls = parseUrlsFromXML(xml)

  // If sitemap index, fetch first sub-sitemap that looks like blog content
  if (urls.length > 0 && urls[0].endsWith('.xml')) {
    const blogSitemap = urls.find((u) =>
      /blog|post|article|news/i.test(u)
    ) ?? urls[0]
    try {
      const subXml = await fetchSitemap(blogSitemap)
      urls = parseUrlsFromXML(subXml)
    } catch {
      // Fall back to first sitemap's URLs as-is
    }
  }

  if (urls.length === 0) {
    return jsonError(422, 'no_urls', 'No URLs found in sitemap')
  }

  // Filter to blog-like URLs only
  const blogUrls = urls.filter((u) =>
    /\/(blog|articles?|posts?|news)\//i.test(u) || u.includes(parsedUrl.pathname)
  )
  const targetUrls = blogUrls.length > 0 ? blogUrls : urls

  if (targetUrls.length > 10000) {
    return jsonError(400, 'too_large', 'Sitemap contains too many URLs (max 10,000)')
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Upsert into scp_article_publications (already-published content)
  const rows = targetUrls.map((url) => ({
    app_id: appId,
    url,
    slug: extractSlug(url),
    status: 'published',
    source: 'sitemap_import',
    published_at: now,
    created_at: now,
    updated_at: now,
  }))

  // Insert in batches of 500
  let imported = 0
  const errors: string[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    const { error } = await admin
      .from('scp_article_publications')
      .upsert(batch, { onConflict: 'app_id,url', ignoreDuplicates: true })
    if (error) {
      errors.push(error.message)
    } else {
      imported += batch.length
    }
  }

  return NextResponse.json({
    sitemap_url: sitemapUrl,
    total_urls_found: urls.length,
    blog_urls_found: targetUrls.length,
    imported,
    errors: errors.length > 0 ? errors : undefined,
  })
}
