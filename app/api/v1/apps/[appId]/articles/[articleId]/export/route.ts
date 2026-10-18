// F-CP-069: Article export — download as markdown or HTML
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

function mdxToHtml(md: string): string {
  return md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[h|l|p])(.+)$/gm, '<p>$1</p>')
    .replace(/<\/p><p>/g, '\n\n')
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const format = request.nextUrl.searchParams.get('format') ?? 'markdown'
  if (!['markdown', 'html', 'json'].includes(format)) {
    return jsonError(400, 'invalid_format', 'format must be markdown, html, or json')
  }

  const admin = createAdminClient()
  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, title, description, body_mdx, focus_keyword, tags, status, published_at, meta_json, updated_at')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const slug = article.slug as string
  const title = article.title as string
  const description = (article.description as string | null) ?? ''
  const bodyMdx = (article.body_mdx as string) ?? ''

  if (format === 'json') {
    return NextResponse.json({
      id: article.id,
      slug,
      title,
      description,
      body_mdx: bodyMdx,
      focus_keyword: article.focus_keyword,
      tags: article.tags,
      status: article.status,
      published_at: article.published_at,
      meta_json: article.meta_json,
    })
  }

  if (format === 'html') {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
</head>
<body>
<article>
<h1>${title}</h1>
${mdxToHtml(bodyMdx)}
</article>
</body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}.html"`,
      },
    })
  }

  // markdown
  const frontmatter = `---
title: "${title}"
description: "${description}"
slug: "${slug}"
focus_keyword: "${article.focus_keyword ?? ''}"
status: "${article.status}"
published_at: "${article.published_at ?? ''}"
---

`
  const markdown = frontmatter + bodyMdx

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}.md"`,
    },
  })
}
